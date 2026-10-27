const { test, expect } = require('@playwright/test');
const fs = require('node:fs'),
  path = require('node:path');
const installMock = require('./ble-mock.cjs');
const root = path.resolve(__dirname, '../web');
async function setup(page, { mock = true, mobile = false } = {}) {
  if (mobile) await page.setViewportSize({ width: 390, height: 844 });
  else await page.setViewportSize({ width: 1360, height: 1000 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (mock) await page.addInitScript(installMock);
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
  await expect(page.locator('#connection')).toHaveText('Connected');
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
  await expect(page.locator('#connection')).toHaveText('Connected');
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
    content: "Object.defineProperty(navigator,'bluetooth',{value:undefined,configurable:true});",
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

test('revoked QR key offers manual re-pair without losing unsaved artwork', async ({ page }) => {
  const errors = await setup(page);
  await connect(page);
  await image(page);
  await page.locator('#title').fill('Keep my artwork');
  await page.evaluate(() => {
    bleMock.password = 'qrstuvwxyz234567';
    badgeDevice.disconnect();
  });
  await page.locator('#connect').click();
  await expect(page.locator('#pair-dialog')).toBeVisible();
  await expect(page.locator('#pair-error')).toHaveText('Wrong pairing key');
  await page.locator('#pair-password').fill('abcd');
  await page.getByRole('button', { name: 'Pair badge', exact: true }).click();
  await expect(page.locator('#connection')).toHaveText('Connected');
  await expect(page.locator('#title')).toHaveValue('Keep my artwork');
  expect(await page.evaluate(() => BadgeEditor.state.dirty)).toBe(true);
  expect(errors).toEqual([]);
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
  await expect(page.locator('#connection')).toHaveText('Connected');
  expect(await page.evaluate(() => BadgeEditor.state.dirty)).toBe(true);
  expect(errors).toEqual([]);
});

test('four-letter pairing remembers the badge and reconnects after refresh without a chooser', async ({
  page,
}) => {
  const errors = await setup(page);
  await page.goto('https://badge.test/LanyardBadge/');
  await page.locator('#connect').click();
  await expect(page.locator('#pair-dialog')).toBeVisible();
  await page.locator('#pair-password').fill('abcd');
  await page.getByRole('button', { name: 'Pair badge', exact: true }).click();
  await expect(page.locator('#connection')).toHaveText('Connected');
  const remembered = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('lanyardbadge.connection')),
  );
  expect(remembered.id).toBe('mock-badge-id');
  expect(remembered.credential).toHaveLength(16);
  const options = await page.evaluate(() => bleMock.discoveryOptions);
  expect(options.filters).toEqual([{ services: [BadgeService()] }, { namePrefix: 'Badge-' }]);
  expect(options.optionalServices).toEqual([BadgeService()]);
  await page.reload();
  await expect(page.locator('#connection')).toHaveText('Connected');
  await expect(page.locator('#pair-dialog')).not.toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('ble.mock.choosers'))).toBe('1');
  await image(page);
  await page.locator('#title').fill('Keep this draft');
  await page.locator('#device-open').click();
  await page.locator('#forget-badge').click();
  await expect(page.locator('#connection')).toHaveText('Disconnected');
  await expect(page.locator('#title')).toHaveValue('Keep this draft');
  expect(await page.evaluate(() => localStorage.getItem('lanyardbadge.connection'))).toBeNull();
  expect(errors).toEqual([]);
});
function BadgeService() {
  return 'f40d1000-6f15-4d56-b6d4-17c92e648a10';
}

test('remembering is optional and unavailable remembered devices never look connected', async ({
  page,
}) => {
  const errors = await setup(page);
  await page.goto('https://badge.test/LanyardBadge/');
  await page.locator('#connect').click();
  await page.locator('#remember-badge').uncheck();
  await page.locator('#pair-password').fill('ABCD');
  await page.getByRole('button', { name: 'Pair badge', exact: true }).click();
  await expect(page.locator('#connection')).toHaveText('Connected');
  expect(await page.evaluate(() => localStorage.getItem('lanyardbadge.connection'))).toBeNull();
  await page.evaluate(() => {
    localStorage.setItem(
      'lanyardbadge.connection',
      JSON.stringify({ id: 'removed-device', name: 'Badge-Test', credential: 'abcdefghijklmnop' }),
    );
  });
  await page.reload();
  await expect(page.locator('#connection')).toHaveText('Disconnected');
  await expect(page.locator('#connect')).toHaveText('Reconnect badge');
  await expect(page.locator('#pair-dialog')).not.toBeVisible();
  expect(errors).toEqual([]);
});

test('a remembered credential invalidated by reflashing offers a new short code', async ({
  page,
}) => {
  const errors = await setup(page);
  await connect(page);
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('lanyardbadge.connection'));
    saved.credential = 'qrstuvwxyz234567';
    localStorage.setItem('lanyardbadge.connection', JSON.stringify(saved));
  });
  await page.reload();
  await expect(page.locator('#pair-dialog')).toBeVisible();
  await expect(page.locator('#pair-error')).toHaveText('Wrong pairing key');
  expect(await page.evaluate(() => localStorage.getItem('lanyardbadge.connection'))).toBeNull();
  await page.locator('#pair-password').fill('ABCD');
  await page.getByRole('button', { name: 'Pair badge', exact: true }).click();
  await expect(page.locator('#connection')).toHaveText('Connected');
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
  await expect(page.locator('#connection')).toHaveText('Connected');
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

test('encrypted reads wait for native pairing and device theme is saved separately', async ({
  page,
}) => {
  const errors = await setup(page);
  await page.evaluate(() => {
    bleMock.securityFailures = 2;
  });
  await connect(page);
  await page.locator('#device-open').click();
  await expect(page.locator('#badge-theme')).toHaveValue('dark');
  await page.locator('#badge-theme').selectOption('light');
  await page.getByText('Save device settings', { exact: true }).click();
  await expect(page.locator('#toast')).toHaveText('Device settings saved.');
  expect(await page.evaluate(() => bleMock.status.darkMode)).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem('ble.mock.choosers'))).toBe('1');
  await expect(page.locator('#system-info')).not.toContainText('heap');
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
  await expect(page.locator('#connection')).toHaveText('Connected');
  expect(await page.evaluate(() => bleMock.sessionStarts)).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem('ble.mock.abandoned'))).toBeNull();
  expect(await page.evaluate(() => bleMock.deck.revision)).toBe(1);
  expect(errors).toEqual([]);
});

test('legacy protocol devices remain connectable without the new session reset', async ({
  page,
}) => {
  const errors = await setup(page);
  await page.evaluate(() => {
    bleMock.protocol = 1;
  });
  await connect(page);
  expect(await page.evaluate(() => bleMock.sessionStarts || 0)).toBe(0);
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
  await expect(page.locator('#connection')).toHaveText('Connected');
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
  await expect(page.locator('#connection')).toHaveText('Connected');
  expect(errors).toEqual([]);
});

test('a stale connected handle lost during encrypted read retries the same granted badge', async ({
  page,
}) => {
  const errors = await setup(page);
  await page.evaluate(() => {
    bleMock.disconnectedReads = 1;
  });
  await connect(page);
  expect(await page.evaluate(() => localStorage.getItem('ble.mock.choosers'))).toBe('1');
  await expect(page.locator('#studio')).toBeVisible();
  expect(errors).toEqual([]);
});

test('GIF files cannot silently replace artwork with only their first frame', async ({ page }) => {
  const errors = await setup(page);
  await image(page);
  const before = await page.locator('#preview').evaluate((c) => c.toDataURL());
  const buffer = fs.readFileSync(path.join(__dirname, 'fixtures/disposal.gif'));
  for (const [name, mimeType] of [
    ['animation.gif', 'image/gif'],
    ['renamed.png', 'image/png'],
  ]) {
    await page.locator('#image-file').setInputFiles({ name, mimeType, buffer });
    await expect(page.locator('#image-file')).toHaveValue('');
    await expect(page.locator('#toast')).toContainText('Animated cards are not supported');
    expect(await page.locator('#preview').evaluate((c) => c.toDataURL())).toBe(before);
    await expect(page.locator('#save-card')).toBeEnabled();
  }
  expect(errors).toEqual([]);
});
