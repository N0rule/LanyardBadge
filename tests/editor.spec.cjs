const { test, expect } = require('@playwright/test');
const fs = require('node:fs'),
  path = require('node:path');
const installMock = require('./ble-mock.cjs');
const root = path.resolve(__dirname, '../web');
async function setup(
  page,
  { mock = true, mobile = false, mockOptions = {}, manualCode = false } = {},
) {
  if (!manualCode) await require('./code-helper.cjs')(page);
  if (mobile) await page.setViewportSize({ width: 390, height: 844 });
  else await page.setViewportSize({ width: 1360, height: 1000 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (mock) await page.addInitScript(installMock, mockOptions);
  await page.route('https://badge.test/**', (route) => {
    let file = new URL(route.request().url()).pathname.replace(/^\/LanyardBadge\/?/, '');
    if (!file) file = 'index.html';
    const resolved = path.resolve(root, file);
    if (!resolved.startsWith(root + '/')) return route.abort();
    if (!fs.existsSync(resolved)) return route.fulfill({ status: 404, body: 'missing' });
    return route.fulfill({ path: resolved });
  });
  await page.goto('https://badge.test/LanyardBadge/#badge=Badge-Test&key=abcdefghijklmnop');
  return errors;
}
async function image(page) {
  if (await page.locator('#studio').isHidden()) await connect(page);
  const data = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 640;
    c.height = 480;
    const x = c.getContext('2d');
    x.fillStyle = '#e02030';
    x.fillRect(0, 0, 320, 240);
    x.fillStyle = '#20b040';
    x.fillRect(320, 0, 320, 240);
    x.fillStyle = '#2040e0';
    x.fillRect(0, 240, 320, 240);
    x.fillStyle = '#f0c020';
    x.fillRect(320, 240, 320, 240);
    return c.toDataURL().split(',')[1];
  });
  await page.locator('#image-file').setInputFiles({
    name: 'artwork.png',
    mimeType: 'image/png',
    buffer: Buffer.from(data, 'base64'),
  });
  await expect(page.locator('#crop-controls')).toBeEnabled();
}
async function connect(page) {
  await page.locator('#connect').click();
  await expect(page.locator('#connection')).toHaveText('Connected via Bluetooth');
}
const pixels = (page) =>
  page.evaluate(() =>
    Array.from(document.querySelector('canvas').getContext('2d').getImageData(0, 0, 240, 320).data),
  );
test('themes restore before paint, follow system, and preserve edits', async ({ page }) => {
  const errors = await setup(page);
  await image(page);
  await page.locator('#title').fill('Unsaved art');
  const before = await page.locator('canvas').evaluate((c) => c.toDataURL());
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('#theme').selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('#title')).toHaveValue('Unsaved art');
  expect(await page.locator('canvas').evaluate((c) => c.toDataURL())).toBe(before);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(errors).toEqual([]);
});
test('rotation cycles, precision, reset, drag and symmetric enclosure', async ({ page }) => {
  const errors = await setup(page);
  await image(page);
  await page.waitForTimeout(40);
  const before = await pixels(page);
  for (let i = 0; i < 4; i++) await page.locator('#rotate-right').click();
  await page.waitForTimeout(40);
  expect(await pixels(page)).toEqual(before);
  await page.locator('#zoom-value').fill('125');
  await expect(page.locator('#zoom')).toHaveValue('125');
  await page.locator('#crop-x').fill('20');
  await expect(page.locator('#crop-x-output')).toHaveText('+20%');
  const box = await page.locator('canvas').boundingBox();
  await page.mouse.move(box.x + 120, box.y + 160);
  await page.mouse.down();
  await page.mouse.move(box.x + 150, box.y + 180, { steps: 5 });
  await page.mouse.up();
  expect(await page.evaluate(() => BadgeEditor.state.x)).toBeGreaterThan(20);
  await page.locator('#reset-transform').click();
  await expect(page.locator('#zoom-value')).toHaveValue('100');
  await expect(page.locator('#crop-x-output')).toHaveText('0%');
  const padding = await page.locator('.badge-object').evaluate((e) => {
    const s = getComputedStyle(e);
    return [s.paddingTop, s.paddingBottom, s.paddingLeft, s.paddingRight];
  });
  expect(new Set(padding).size).toBe(1);
  expect(errors).toEqual([]);
});
test('simulated GATT: minimum MTU, upload/export consistency, settings and reconnect', async ({
  page,
}) => {
  const errors = await setup(page);
  await connect(page);
  await image(page);
  await page.locator('#rotate-right').click();
  await page.locator('#zoom-value').fill('125');
  await page.waitForTimeout(40);
  const preview = await pixels(page);
  // Faster mocked MTU for the full image; the connection/pairing above exercised MTU 23.
  await page.evaluate(() => {
    bleMock.mtu = 247;
    badgeDevice.packetBytes = 244;
  });
  await page.locator('#save-card').click();
  await expect(page.locator('#save-state')).toHaveText('Card uploaded', { timeout: 15000 });
  const decoded = await page.evaluate(() =>
    Array.from(BadgeCodec.decodeBMP(bleMock.uploads[0].buffer)),
  );
  const error = [0, 0, 0];
  for (let i = 0; i < preview.length; i += 4)
    for (let channel = 0; channel < 3; channel++)
      error[channel] = Math.max(
        error[channel],
        Math.abs(preview[i + channel] - decoded[i + channel]),
      );
  expect(error[0]).toBeLessThanOrEqual(7);
  expect(error[1]).toBeLessThanOrEqual(3);
  expect(error[2]).toBeLessThanOrEqual(7);
  await page.locator('#device-open').click();
  await page.locator('#screen-timeout').selectOption('30');
  await page.getByText('Save device settings', { exact: true }).click();
  await expect(page.locator('#toast')).toHaveText('Device settings saved.');
  expect(await page.evaluate(() => bleMock.status.screenTimeout)).toBe(30);
  await page.locator('#disconnect').click();
  await expect(page.locator('#connection')).toHaveText('Disconnected');
  await page.locator('#connect').click();
  await expect(page.locator('#connection')).toHaveText('Connected via Bluetooth');
  expect(errors).toEqual([]);
});
test('metadata failure retains transform and uploaded asset for retry', async ({ page }) => {
  const errors = await setup(page);
  await connect(page);
  await image(page);
  await page.evaluate(() => {
    bleMock.mtu = 247;
    badgeDevice.packetBytes = 244;
    bleMock.failCommit = true;
  });
  await page.locator('#save-card').click();
  await expect(page.locator('#toast')).toHaveText('Metadata commit failed', { timeout: 15000 });
  expect(await page.evaluate(() => BadgeEditor.changed)).toBe(true);
  expect(await page.evaluate(() => BadgeEditor.state.dirty)).toBe(true);
  await page.locator('#save-card').click();
  await expect(page.locator('#save-state')).toHaveText('Card uploaded', { timeout: 15000 });
  expect(await page.evaluate(() => bleMock.uploads.length)).toBe(1);
  expect(errors).toEqual([]);
});

test('unsupported GIF decoding keeps the previous original artwork and dirty title', async ({
  page,
}) => {
  await setup(page);
  await connect(page);
  await image(page);
  await page.locator('#title').fill('Keep my static source');
  await page.evaluate(() => {
    globalThis.previousGIFSelection = BadgeEditor.state.image;
    globalThis.ImageDecoder = undefined;
  });
  await page.locator('#image-file').setInputFiles(path.join(__dirname, 'fixtures/disposal.gif'));
  await expect(page.locator('#toast')).toContainText('cannot prepare animated GIFs');
  await expect(page.locator('#title')).toHaveValue('Keep my static source');
  expect(
    await page.evaluate(
      () => BadgeEditor.changed && BadgeEditor.state.image === previousGIFSelection,
    ),
  ).toBe(true);
});
test('mobile pointer dragging, page width, keyboard, and fit/rotation', async ({ page }) => {
  const errors = await setup(page, { mobile: true });
  await image(page);
  const dimensions = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  expect(dimensions[0]).toBeLessThanOrEqual(dimensions[1]);
  await page.locator('#fit').selectOption('contain');
  await page.locator('#rotate-left').click();
  await page.locator('#zoom-value').fill('125');
  await page.locator('canvas').scrollIntoViewIfNeeded();
  const box = await page.locator('canvas').boundingBox();
  const scroll = await page.evaluate(() => scrollY);
  const cdp = await page.context().newCDPSession(page);
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: point.x + 18, y: point.y + 10 }],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect(await page.evaluate(() => BadgeEditor.state.x)).toBeGreaterThan(0);
  expect(await page.evaluate(() => scrollY)).toBe(scroll);
  await page.locator('#reset-transform').click();
  await page.locator('canvas').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#crop-y-output')).toHaveText('+1%');
  await page.screenshot({ path: '../test-results/editor-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});
test('unsupported browser guidance and subpath assets', async ({ page }) => {
  const errors = await setup(page, { mock: false });
  await page.addScriptTag({
    content:
      "for (const name of ['bluetooth', 'serial']) Object.defineProperty(navigator,name,{value:undefined,configurable:true});",
  });
  await page.locator('#connect').click();
  await expect(page.locator('#connection')).toHaveText('Unsupported browser');
  await expect(page.locator('#toast')).toContainText('Web Bluetooth');
  expect(errors).toEqual([]);
});

test('deleting final saved card returns an editable draft without a device placeholder', async ({
  page,
}) => {
  const errors = await setup(page);
  await connect(page);
  page.on('dialog', (dialog) => dialog.accept());
  await page.locator('#delete-card').click();
  await expect(page.locator('#toast')).toHaveText('Card deleted.');
  expect(await page.evaluate(() => bleMock.deck.cards.length)).toBe(0);
  await expect(page.locator('#title')).toHaveValue('My artwork');
  expect(errors).toEqual([]);
});

test('response timeout measures inactivity instead of total download duration', async ({
  page,
}) => {
  await setup(page);
  await connect(page);
  await page.clock.install();
  await page.evaluate(() => {
    bleMock.replyDelay = 1000;
    globalThis.slowDone = false;
    globalThis.slowError = '';
    badgeDevice
      .getStatus()
      .then(() => (slowDone = true))
      .catch((e) => (slowError = e.message));
  });
  await page.clock.runFor(60000);
  expect(await page.evaluate(() => slowError)).toBe('');
  expect(await page.evaluate(() => slowDone)).toBe(true);
});

test('expired API session disconnects clearly and keeps artwork for reconnect', async ({
  page,
}) => {
  const errors = await setup(page);
  await connect(page);
  await image(page);
  await page.evaluate(() => {
    bleMock.expireNext = true;
  });
  await page.locator('#save-card').click();
  await expect(page.locator('#connection')).toHaveText('Disconnected');
  await expect(page.locator('#toast')).toContainText('Session expired');
  expect(await page.evaluate(() => BadgeEditor.state.dirty)).toBe(true);
  await page.locator('#connect').click();
  await expect(page.locator('#connection')).toHaveText('Connected via Bluetooth');
  expect(await page.evaluate(() => BadgeEditor.state.dirty)).toBe(true);
  expect(errors).toEqual([]);
});

test('failed automatic reconnect stays disconnected and keeps remembered access for retry', async ({
  page,
}) => {
  const errors = await setup(page);
  await connect(page);
  await page.evaluate(() => localStorage.setItem('ble.mock.failConnect', 'yes'));
  await page.reload();
  await expect(page.locator('#connection')).toHaveText('Disconnected');
  await expect(page.locator('#toast')).toContainText('Bluetooth could not establish a connection');
  expect(await page.evaluate(() => localStorage.getItem('lanyardbadge.connection'))).not.toBeNull();
  await page.evaluate(() => localStorage.removeItem('ble.mock.failConnect'));
  await page.locator('#connect').click();
  await expect(page.locator('#connection')).toHaveText('Connected via Bluetooth');
  await expect(page.locator('#pair-dialog')).not.toBeVisible();
  expect(errors).toEqual([]);
});

test('disconnected landing has only connect and install, then opens a neutral empty editor', async ({
  page,
}) => {
  const errors = await setup(page);
  await expect(page.locator('#studio')).toBeHidden();
  await expect(page.locator('#welcome button:visible')).toHaveCount(2);
  await expect(page.locator('#device-open')).toBeHidden();
  await page.locator('#theme').selectOption('light');
  expect(await page.locator('body').evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(
    'rgb(255, 255, 255)',
  );
  await page.evaluate(() => {
    bleMock.deck.cards = [];
  });
  await connect(page);
  await expect(page.locator('#welcome')).toBeHidden();
  await expect(page.locator('#studio')).toBeVisible();
  const colors = await page.evaluate(() => {
    const c = document.getElementById('preview'),
      p = c.getContext('2d').getImageData(0, 0, 240, 320).data;
    return Array.from(
      new Set(
        Array.from({ length: p.length / 4 }, (_, i) =>
          [p[i * 4], p[i * 4 + 1], p[i * 4 + 2]].join(','),
        ),
      ),
    );
  });
  expect(colors).toEqual(['241,243,245']);
  await page.locator('#disconnect-top').click();
  await expect(page.locator('#studio')).toBeHidden();
  await expect(page.locator('#welcome')).toBeVisible();
  expect(errors).toEqual([]);
});

test('reconnect waits for the previous page GATT connection to finish closing', async ({
  page,
}) => {
  const errors = await setup(page);
  await page.evaluate(() => {
    bleMock.busyConnects = 2;
  });
  await connect(page);
  expect(await page.evaluate(() => localStorage.getItem('ble.mock.choosers'))).toBe('1');
  await expect(page.locator('#studio')).toBeVisible();
  expect(errors).toEqual([]);
});

test('a new page resets an abandoned response on a retained physical BLE link', async ({
  page,
}) => {
  const errors = await setup(page);
  await connect(page);
  await page.evaluate(() => localStorage.setItem('ble.mock.abandoned', 'yes'));
  await page.reload();
  await expect(page.locator('#connection')).toHaveText('Connected via Bluetooth');
  expect(await page.evaluate(() => bleMock.sessionStarts)).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem('ble.mock.abandoned'))).toBeNull();
  expect(await page.evaluate(() => bleMock.deck.revision)).toBe(1);
  expect(errors).toEqual([]);
});

test('an old interrupted download cannot disconnect a replacement connection', async ({ page }) => {
  const errors = await setup(page);
  await connect(page);
  const result = await page.evaluate(async () => {
    bleMock.replyDelay = 80;
    const old = badgeDevice.getStatus().catch((error) => error.message);
    await new Promise((resolve) => setTimeout(resolve, 30));
    badgeDevice.disconnect();
    bleMock.replyDelay = 0;
    await badgeDevice.reconnect();
    await badgeDevice.pair(bleMock.password);
    await old;
    const status = await badgeDevice.getStatus();
    return { connected: badgeDevice.device.gatt.connected, brightness: status.brightness };
  });
  expect(result).toEqual({ connected: true, brightness: 65 });
  expect(errors).toEqual([]);
});

test('disconnect cancels an unsettled native write before reconnecting', async ({ page }) => {
  const errors = await setup(page);
  await connect(page);
  const result = await page.evaluate(async () => {
    bleMock.stallNextCompletion = true;
    const old = badgeDevice.getStatus().catch((error) => error.message);
    while (bleMock.stallNextCompletion) await new Promise((resolve) => setTimeout(resolve, 5));
    badgeDevice.disconnect();
    await badgeDevice.reconnect();
    await badgeDevice.pair(bleMock.password);
    const oldError = await old;
    return {
      connected: badgeDevice.device.gatt.connected,
      oldRejected: typeof oldError === 'string',
      status: (await badgeDevice.getStatus()).brightness,
    };
  });
  expect(result).toEqual({ connected: true, oldRejected: true, status: 65 });
  expect(errors).toEqual([]);
});

test('queued old requests cannot reuse or renumber a replacement session', async ({ page }) => {
  const errors = await setup(page);
  await connect(page);
  const result = await page.evaluate(async () => {
    bleMock.replyDelay = 80;
    const first = badgeDevice.getStatus().catch((error) => error.message);
    const queued = badgeDevice.getCards().catch((error) => error.message);
    await new Promise((resolve) => setTimeout(resolve, 20));
    badgeDevice.disconnect();
    bleMock.replyDelay = 0;
    await badgeDevice.reconnect();
    await badgeDevice.pair(bleMock.password);
    return {
      rejected: (await Promise.all([first, queued])).every((value) => typeof value === 'string'),
      cards: (await badgeDevice.getCards()).cards.length,
    };
  });
  expect(result).toEqual({ rejected: true, cards: 1 });
  expect(errors).toEqual([]);
});

test('same-page reconnect renews a stale native notification subscription', async ({ page }) => {
  const errors = await setup(page);
  await connect(page);
  await page.evaluate(() => {
    badgeDevice.disconnect();
    bleMock.subscriptionStale = true;
  });
  await page.locator('#connect').click();
  await expect(page.locator('#connection')).toHaveText('Connected via Bluetooth');
  expect(await page.evaluate(() => bleMock.stoppedSubscriptions)).toBe(1);
  expect(errors).toEqual([]);
});

test('new card workflow reveals editing after choosing artwork and preserves the three columns', async ({
  page,
}) => {
  const errors = await setup(page);
  await page.evaluate(() => {
    bleMock.deck.cards = [];
  });
  await connect(page);
  await expect(page.locator('#crop-controls')).toBeHidden();
  await expect(page.locator('#save-card')).toBeDisabled();
  await expect(page.locator('#show-card')).toBeDisabled();
  await expect(page.locator('#artwork-action')).toHaveText('Choose artwork');
  await image(page);
  await expect(page.locator('#title')).toHaveValue('artwork');
  await expect(page.locator('#crop-controls')).toBeVisible();
  await expect(page.locator('#artwork-action')).toHaveText('Replace artwork');
  await expect(page.locator('#save-card')).toBeEnabled();
  await expect(page.locator('#letterbox-control')).toBeHidden();
  await page.locator('#fit').selectOption('contain');
  await expect(page.locator('#letterbox-control')).toBeVisible();
  const boxes = await Promise.all(
    ['.gallery', '.preview-space', '.inspector'].map((s) => page.locator(s).boundingBox()),
  );
  expect(boxes[0].x + boxes[0].width).toBeLessThanOrEqual(boxes[1].x + 1);
  expect(boxes[1].x + boxes[1].width).toBeLessThanOrEqual(boxes[2].x + 1);
  await page.locator('#theme').selectOption('light');
  await page.screenshot({ path: '../test-results/studio-desktop-light.png', fullPage: true });
  await page.locator('#theme').selectOption('dark');
  await page.screenshot({ path: '../test-results/studio-desktop-dark.png', fullPage: true });
  await page.locator('#title').fill('My own title');
  await image(page);
  await expect(page.locator('#title')).toHaveValue('My own title');
  expect(errors).toEqual([]);
});

test('duplicate native notification events retain a single complete response', async ({ page }) => {
  const errors = await setup(page);
  await page.evaluate(() => {
    bleMock.duplicateNotifications = true;
  });
  await connect(page);
  const cards = await page.evaluate(() => badgeDevice.getCards());
  expect(cards.cards[0].title).toBe('First card');
  await expect(page.locator('#connection')).toHaveText('Connected via Bluetooth');
  expect(errors).toEqual([]);
});

test('legacy firmware rejects GIF upload without replacing the existing artwork', async ({
  page,
}) => {
  const errors = await setup(page, { mockOptions: { animationFormat: 0 } });
  await image(page);
  const before = await page.locator('#preview').evaluate((c) => c.toDataURL());
  const buffer = fs.readFileSync(path.join(__dirname, 'fixtures/disposal.gif'));
  for (const [name, mimeType] of [
    ['animation.gif', 'image/gif'],
    ['renamed.png', 'image/png'],
  ]) {
    await page.locator('#image-file').setInputFiles({ name, mimeType, buffer });
    await expect(page.locator('#image-file')).toHaveValue('');
    await expect(page.locator('#toast')).toContainText('Update your badge firmware');
    expect(await page.locator('#preview').evaluate((c) => c.toDataURL())).toBe(before);
    await expect(page.locator('#save-card')).toBeEnabled();
  }
  expect(errors).toEqual([]);
});

test('GIF preview, adjustments, animation upload and cached reconnect retain all frames', async ({
  page,
}) => {
  const errors = await setup(page, { mockOptions: { mtu: 517, snapshot: true } });
  await connect(page);
  await page.locator('#image-file').setInputFiles({
    name: 'disposal.gif',
    mimeType: 'image/gif',
    buffer: fs.readFileSync(path.join(__dirname, 'fixtures/disposal.gif')),
  });
  await expect(page.locator('#artwork-status')).toHaveText('GIF animation · 4 frames');
  const first = await page.locator('#preview').evaluate((c) => c.toDataURL());
  await expect.poll(() => page.locator('#preview').evaluate((c) => c.toDataURL())).not.toBe(first);
  await page.locator('#animation-toggle').click();
  await expect(page.locator('#animation-toggle')).toHaveText('Play animation');
  await page.locator('#fit').selectOption('contain');
  await page.locator('#rotate-right').click();
  await page.locator('#title').fill('Moving artwork');
  await page.locator('#save-card').click();
  await expect(page.locator('#save-state')).toHaveText('Card uploaded');
  const report = await page.evaluate(() => {
    const bytes = bleMock.uploads[0].buffer;
    const animation = BadgeGIF.parse(bytes);
    return {
      path: bleMock.lastUploadPath,
      frames: animation.frames.length,
      duration: animation.durationMs,
      delays: animation.frames.map((f) => f.durationMs),
      plays: animation.plays,
      original: BadgeEditor.state.animationSource instanceof Blob,
    };
  });
  expect(report).toEqual({
    path: '/api/animations',
    frames: 4,
    duration: 560,
    delays: [80, 120, 160, 200],
    plays: 3,
    original: true,
  });
  await page.evaluate(() => badgeDevice.disconnect());
  await connect(page);
  await expect(page.locator('#artwork-status')).toHaveText('GIF animation · 4 frames');
  expect(
    await page.evaluate(() => bleMock.requests.filter((p) => p.startsWith('/api/image')).length),
  ).toBe(0);
  await page.locator('#title').fill('Only the title changed');
  await page.locator('#save-card').click();
  await expect(page.locator('#save-state')).toHaveText('Card uploaded');
  expect(await page.evaluate(() => bleMock.uploads.length)).toBe(1);
  await page.locator('#rotate-right').click();
  await page.locator('#save-card').click();
  await expect(page.locator('#save-state')).toHaveText('Card uploaded');
  expect(
    await page.evaluate(() => ({
      uploads: bleMock.uploads.length,
      frames: BadgeGIF.parse(bleMock.uploads[1].buffer).frames.length,
      duration: BadgeGIF.parse(bleMock.uploads[1].buffer).durationMs,
    })),
  ).toEqual({ uploads: 2, frames: 4, duration: 560 });
  expect(errors).toEqual([]);
});

test('preview group shares its horizontal and vertical center during upload on desktop and mobile', async ({
  page,
}) => {
  await setup(page);
  await connect(page);
  for (const viewport of [
    { width: 1360, height: 1000 },
    { width: 780, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => {
      document.querySelector('#upload-state').hidden = false;
      document.querySelector('#upload-label').textContent = 'Uploading card… 66%';
      document.querySelector('#upload-progress').value = 66;
    });
    const bounds = await page.evaluate(() => {
      const rect = (s) => document.querySelector(s).getBoundingClientRect();
      const section = rect('.preview-space'),
        heading = rect('.preview-heading'),
        upload = rect('#upload-state');
      return {
        center: section.x + section.width / 2,
        children: ['.preview-heading', '.badge-object', '.publish-actions', '#upload-state'].map(
          (s) => {
            const b = rect(s);
            return b.x + b.width / 2;
          },
        ),
        vertical: (heading.y + upload.bottom) / 2 - (section.y + section.height / 2),
      };
    });
    for (const center of bounds.children) expect(Math.abs(center - bounds.center)).toBeLessThan(1);
    expect(Math.abs(bounds.vertical)).toBeLessThan(2);
  }
});

test('remote deletion and full collection retain drafts and require explicit conflict review', async ({
  page,
}) => {
  await setup(page, { mockOptions: { snapshot: true } });
  await connect(page);
  await image(page);
  await page.locator('#title').fill('Locally edited deleted card');
  await page.evaluate(() => {
    const base = bleMock.deck.cards[0];
    bleMock.deck.cards = Array.from({ length: 10 }, (_, i) => ({
      ...base,
      id: (i + 16).toString(16).padStart(8, '0'),
      title: 'Remote card ' + i,
    }));
    bleMock.deck.revision++;
    badgeDevice.disconnect();
  });
  await connect(page);
  await expect(page.locator('#title')).toHaveValue('Locally edited deleted card');
  expect(await page.evaluate(() => BadgeEditor.deck.cards.length)).toBe(11);
  expect(await page.evaluate(() => BadgeEditor.conflict)).toBe(true);
  await expect(page.locator('#toast')).toContainText('changed elsewhere');
  page.once('dialog', (d) => d.dismiss());
  await page.locator('#save-card').click();
  expect(await page.evaluate(() => BadgeEditor.changed)).toBe(true);
});

test('explicit reload cancel retains draft and confirmed reload discards it', async ({ page }) => {
  await setup(page);
  await connect(page);
  await image(page);
  await page.locator('#title').fill('Draft');
  await page.locator('details.storage summary').click();
  page.once('dialog', (d) => d.dismiss());
  await page.locator('#reload').click();
  await expect(page.locator('#title')).toHaveValue('Draft');
  page.once('dialog', (d) => d.accept());
  await page.locator('#reload').click();
  await expect(page.locator('#title')).toHaveValue('First card');
  expect(await page.evaluate(() => BadgeEditor.changed)).toBe(false);
});

test('switching badge identities retains independent source drafts', async ({ page }) => {
  await setup(page);
  await connect(page);
  await image(page);
  await page.locator('#title').fill('Badge one draft');
  await page.evaluate(() => {
    badgeDevice.disconnect();
    badgeDevice.device.id = 'badge-two';
  });
  await connect(page);
  await image(page);
  await page.locator('#title').fill('Badge two draft');
  await page.evaluate(() => {
    badgeDevice.disconnect();
    badgeDevice.device.id = 'mock-badge-id';
  });
  await connect(page);
  await expect(page.locator('#title')).toHaveValue('Badge one draft');
  expect(await page.evaluate(() => BadgeEditor.state.image.width)).toBe(640);
  await page.evaluate(() => {
    badgeDevice.disconnect();
    badgeDevice.device.id = 'badge-two';
  });
  await connect(page);
  await expect(page.locator('#title')).toHaveValue('Badge two draft');
});

test('late service discovery cannot replace or disconnect a newer session', async ({ page }) => {
  await setup(page);
  await connect(page);
  const result = await page.evaluate(async () => {
    const device = badgeDevice.device,
      original = device.gatt.connect;
    let release, started;
    const ready = new Promise((r) => {
      started = r;
    });
    device.gatt.connect = async () => ({
      getPrimaryService: async () => {
        started();
        await new Promise((r) => {
          release = r;
        });
        throw new DOMException('Old service discovery failed', 'NetworkError');
      },
    });
    const old = badgeDevice.reconnect().catch((e) => e.staleSession);
    await ready;
    device.gatt.connect = original;
    await badgeDevice.reconnect();
    const replacement = badgeDevice.session;
    release();
    return {
      stale: await old,
      sameSession: replacement === badgeDevice.session,
      connected: device.gatt.connected,
    };
  });
  expect(result).toEqual({ stale: true, sameSession: true, connected: true });
});

for (const stage of ['service', 'subscription']) {
  test(`connection diagnostics distinguish ${stage} failure`, async ({ page }) => {
    await setup(page);
    await connect(page);
    await page.evaluate((stage) => {
      badgeDevice.disconnect();
      if (stage === 'service') {
        badgeDevice.device.gatt.connect = async () => ({
          getPrimaryService: async () => {
            throw new DOMException('Missing service', 'NotFoundError');
          },
        });
      } else
        badgeDevice.tx.startNotifications = async () => {
          throw new DOMException('Subscription rejected', 'NotSupportedError');
        };
    }, stage);
    await page.locator('#connect').click();
    await expect(page.locator('#connection')).toHaveText('Disconnected');
    await expect(page.locator('#toast')).toContainText(
      stage === 'service' ? 'service is incompatible' : 'notifications could not start',
    );
  });
}

test('saving one card retains other dirty source drafts across reconnect', async ({ page }) => {
  await setup(page, { mockOptions: { mtu: 517, snapshot: true } });
  await connect(page);
  await image(page);
  await page.locator('#title').fill('First source draft');
  await page.locator('#new-card').click();
  await image(page);
  await page.locator('#title').fill('Second uploaded card');
  await page.locator('#save-card').click();
  await expect(page.locator('#upload-label')).toHaveText('Card uploaded');
  expect(await page.evaluate(() => BadgeEditor.changed)).toBe(true);
  await page.evaluate(() => badgeDevice.disconnect());
  await connect(page);
  await page.locator('.gallery-card').first().click();
  await expect(page.locator('#title')).toHaveValue('First source draft');
  expect(
    await page.evaluate(() => ({
      dirty: BadgeEditor.state.dirty,
      width: BadgeEditor.state.image.width,
    })),
  ).toEqual({ dirty: true, width: 640 });
});

test('remote unedited metadata refreshes while a matching local draft stays separate', async ({
  page,
}) => {
  await setup(page, { mockOptions: { snapshot: true } });
  await connect(page);
  await image(page);
  await page.locator('#title').fill('Local first card');
  await page.evaluate(() => {
    bleMock.deck.cards.push({
      ...bleMock.deck.cards[0],
      id: '00000002',
      title: 'Remote second card',
    });
    bleMock.deck.revision++;
    badgeDevice.disconnect();
  });
  await connect(page);
  await expect(page.locator('#title')).toHaveValue('Local first card');
  await expect(page.locator('.gallery-card').nth(1)).toContainText('Remote second card');
  expect(await page.evaluate(() => BadgeEditor.conflict)).toBe(true);
});

test('first connection retries a link lost after successful native discovery', async ({ page }) => {
  const errors = await setup(page, { mockOptions: { dropDiscovery: 1 } });
  await connect(page);
  await expect(page.locator('#studio')).toBeVisible();
  await expect(page.locator('#toast')).not.toContainText('Previous Bluetooth session closed');
  expect(await page.evaluate(() => bleMock.dropDiscovery)).toBe(0);
  expect(errors).toEqual([]);
});

test('a delayed disconnect event from a closed link does not invalidate a connected replacement', async ({
  page,
}) => {
  await setup(page);
  await connect(page);
  const result = await page.evaluate(async () => {
    badgeDevice.disconnect();
    await badgeDevice.reconnect();
    const session = badgeDevice.session;
    badgeDevice.device.dispatchEvent(new Event('gattserverdisconnected'));
    return { unchanged: session === badgeDevice.session, state: badgeDevice.state };
  });
  expect(result).toEqual({ unchanged: true, state: 'pairing' });
});

test('loading status text stays centered on the physical badge for every percentage', async ({
  page,
}) => {
  await setup(page);
  await connect(page);
  for (const width of [320, 390, 780, 1360, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    let previousY;
    for (const text of [
      'Loading card… 4%',
      'Loading card… 45%',
      'Loading card… 100%',
      'Preparing artwork…',
      'Card ready',
      'Preview unavailable',
    ]) {
      const geometry = await page.evaluate((text) => {
        const help = document.querySelector('#preview-help');
        help.textContent = text;
        const range = document.createRange();
        range.selectNodeContents(help);
        const label = range.getBoundingClientRect(),
          badge = document.querySelector('.badge-object').getBoundingClientRect();
        return {
          difference: label.x + label.width / 2 - (badge.x + badge.width / 2),
          y: badge.y,
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      }, text);
      expect(Math.abs(geometry.difference)).toBeLessThan(1);
      expect(geometry.overflow).toBe(false);
      if (previousY !== undefined) expect(geometry.y).toBe(previousY);
      previousY = geometry.y;
    }
    await page.screenshot({
      path: `../test-results/preview-alignment-${width}.png`,
      fullPage: true,
    });
  }
});

test('firmware identity upgrade keeps the existing browser-keyed draft', async ({ page }) => {
  const errors = await setup(page, { mockOptions: { snapshot: true } });
  await connect(page);
  await page.locator('#title').fill('Keep through firmware update');
  await page.locator('#disconnect-top').click();
  await page.evaluate(() => {
    bleMock.status.deviceId = '0123456789abcdef';
    bleMock.status.cacheEpoch = 'public-generation';
  });
  await connect(page);
  await expect(page.locator('#title')).toHaveValue('Keep through firmware update');
  expect(await page.evaluate(() => BadgeEditor.changed)).toBe(true);
  expect(errors).toEqual([]);
});

test('device name and reset request use shared API with deliberate confirmation', async ({
  page,
}) => {
  const errors = await setup(page, { mockOptions: { protocol: 4, snapshot: true } });
  await connect(page);
  await page.evaluate(() =>
    Object.assign(bleMock.status, { deviceName: 'LanyardBadge', factoryReset: true }),
  );
  await page.locator('#device-open').click();
  await page.locator('#device-name').fill('Convention Badge');
  await page.getByRole('button', { name: 'Save name', exact: true }).click();
  await expect(page.locator('#name-status')).toHaveText('Device name saved.');
  expect(await page.evaluate(() => bleMock.status.deviceName)).toBe('Convention Badge');
  await page.locator('#device-dialog summary').click();
  page.once('dialog', (d) => d.dismiss());
  await page.locator('#factory-reset').click();
  expect(await page.evaluate(() => !!bleMock.resetRequested)).toBe(false);
  page.once('dialog', (d) => d.accept());
  await page.locator('#factory-reset').click();
  await expect(page.locator('#reset-status')).toContainText(
    'tapping Erase everything on the badge',
  );
  expect(await page.evaluate(() => bleMock.deck.cards.length)).toBe(1);
  await expect(page.locator('#reset-status')).not.toContainText('BOOT');
  expect(errors).toEqual([]);
});

test('four-letter code gates editing, retries mistakes and is never remembered', async ({
  page,
}) => {
  await setup(page, { manualCode: true });
  await page.locator('#connect').click();
  await expect(page.locator('#pair-dialog')).toBeVisible();
  await expect(page.locator('#studio')).toBeHidden();
  await page.locator('#pair-code').fill('ZZZZ');
  await page.locator('#pair-submit').click();
  await expect(page.locator('#pair-error')).toContainText('Incorrect code');
  await expect(page.locator('#studio')).toBeHidden();
  await page.locator('#pair-code').fill('abcd');
  await page.locator('#pair-submit').click();
  await expect(page.locator('#connection')).toHaveText('Connected via Bluetooth');
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('ABCD');
  await page.locator('#disconnect-top').click();
  await page.locator('#connect').click();
  await expect(page.locator('#pair-dialog')).toBeVisible();
  await expect(page.locator('#pair-code')).toHaveValue('');
  await page.locator('#pair-cancel').click();
  await expect(page.locator('#connection')).toHaveText('Disconnected');
});
test('old native-pairing firmware requires an update rather than a Windows prompt', async ({
  page,
}) => {
  await setup(page, { manualCode: true, mockOptions: { protocol: 3 } });
  await page.locator('#connect').click();
  await expect(page.locator('#toast')).toContainText('Update your badge firmware');
  await expect(page.locator('#pair-dialog')).not.toBeVisible();
});
