const { test, expect } = require('@playwright/test');
const fs = require('node:fs'),
  path = require('node:path');
const bleMock = require('./ble-mock.cjs'),
  serialMock = require('./serial-mock.cjs');
async function setup(page, config = {}) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(bleMock, { serial: true, mtu: 515, snapshot: true });
  await page.addInitScript(serialMock, config);
  const root = path.resolve(__dirname, '../web');
  await page.route('https://badge.test/**', (route) => {
    const file =
      new URL(route.request().url()).pathname.replace(/^\/LanyardBadge\/?/, '') || 'index.html';
    const resolved = path.resolve(root, file);
    if (!resolved.startsWith(root + '/') || !fs.existsSync(resolved))
      return route.fulfill({ status: 404, body: 'missing' });
    return route.fulfill({ path: resolved });
  });
  await page.goto('https://badge.test/LanyardBadge/');
  return errors;
}
test('USB permission, handshake, settings, still/GIF bytes and clean release', async ({ page }) => {
  const errors = await setup(page);
  await page.locator('#connect').click();
  await page.locator('#connect-usb').click();
  await expect(page.locator('#connection')).toHaveText('Connected via USB');
  await expect(page.locator('#pair-dialog')).not.toBeVisible();
  const result = await page.evaluate(async () => {
    const t = badgeDevice;
    await t.updateSettings({ brightness: 80 });
    const bytes = Uint8Array.from({ length: 153666 }, (_, i) => i & 255);
    await t.uploadCard(bytes.buffer);
    const saved = await t.getArtwork('abcdef01');
    const animation = Uint8Array.from({ length: 2048 }, (_, i) => (i * 7) & 255);
    await t.uploadCard(animation.buffer, undefined, true);
    const gif = await t.getArtwork('abcdef01', { total: animation.length, rangeBytes: 1024 });
    return {
      still: [...new Uint8Array(saved)].every((b, i) => b === bytes[i]),
      gif: [...new Uint8Array(gif)].every((b, i) => b === animation[i]),
      brightness: (await t.getStatus()).brightness,
    };
  });
  expect(result).toEqual({ still: true, gif: true, brightness: 80 });
  await page.locator('#disconnect-top').click();
  await expect.poll(() => page.evaluate(() => serialMock.closes)).toBe(1);
  expect(
    await page.evaluate(() => ({
      goodbye: serialMock.goodbye,
      signals: serialMock.signals,
      baud: serialMock.options.baudRate,
      choosers: serialMock.choosers,
    })),
  ).toEqual({
    goodbye: true,
    signals: [{ dataTerminalReady: false, requestToSend: false }],
    baud: 115200,
    choosers: 1,
  });
  expect(errors).toEqual([]);
});
test('USB auto reconnect avoids chooser and unplug preserves the draft', async ({ page }) => {
  const errors = await setup(page, { authorized: true });
  await expect(page.locator('#connection')).toHaveText('Connected via USB');
  await page.locator('#title').fill('Keep this draft');
  await page.evaluate(() => serialMock.unplug());
  await expect(page.locator('#connection')).toHaveText('Disconnected');
  await expect.poll(() => page.evaluate(() => serialMock.closes)).toBe(1);
  await page.locator('#connect').click();
  await expect(page.locator('#connection')).toHaveText('Connected via USB');
  await expect(page.locator('#title')).toHaveValue('Keep this draft');
  expect(await page.evaluate(() => serialMock.choosers)).toBe(0);
  expect(errors).toEqual([]);
});
test('silent old firmware never enters editor and releases the serial port', async ({ page }) => {
  const errors = await setup(page, { silent: true, authorized: true });
  await expect(page.locator('#toast')).toContainText('No compatible USB firmware', {
    timeout: 12000,
  });
  await expect(page.locator('#studio')).not.toBeVisible();
  await expect.poll(() => page.evaluate(() => serialMock.closes)).toBe(1);
  expect(errors).toEqual([]);
});

test('canceling USB upload discards the transfer and permits a fresh session', async ({ page }) => {
  const errors = await setup(page, { authorized: true });
  await expect(page.locator('#connection')).toHaveText('Connected via USB');
  const message = await page.evaluate(async () => {
    try {
      await badgeDevice.uploadCard(new Uint8Array(153666).buffer, (p) => {
        if (p > 0) void badgeDevice.disconnect();
      });
      return 'unexpected completion';
    } catch (e) {
      return e.message;
    }
  });
  expect(message).not.toBe('unexpected completion');
  await expect.poll(() => page.evaluate(() => serialMock.closes)).toBe(1);
  expect(await page.evaluate(() => bleMock.uploads.length)).toBe(0);
  await page.locator('#connect').click();
  await expect(page.locator('#connection')).toHaveText('Connected via USB');
  expect(errors).toEqual([]);
});

test('USB timeout releases its port and keeps unsaved metadata', async ({ page }) => {
  const errors = await setup(page, { authorized: true });
  await expect(page.locator('#connection')).toHaveText('Connected via USB');
  await page.locator('#title').fill('Recover me');
  await page.clock.install();
  await page.evaluate(() => {
    serialMock.dropResponses = true;
    globalThis.failedRequest = badgeDevice.getStatus().then(
      () => 'unexpected success',
      (e) => e.message,
    );
  });
  await page.clock.fastForward(16000);
  expect(await page.evaluate(() => failedRequest)).toContain('timed out');
  await expect(page.locator('#connection')).toHaveText('Disconnected');
  await expect.poll(() => page.evaluate(() => serialMock.closes)).toBe(1);
  expect(await page.evaluate(() => BadgeEditor.deck.cards[0].title)).toBe('Recover me');
  expect(errors).toEqual([]);
});

test('closing USB cancels an unsettled native write before reconnect', async ({ page }) => {
  const errors = await setup(page, { authorized: true });
  await expect(page.locator('#connection')).toHaveText('Connected via USB');
  await page.evaluate(() => {
    badgeDevice.writer.write = () => new Promise(() => {});
    globalThis.failedRequest = badgeDevice.getStatus().catch((e) => e.message);
  });
  await page.locator('#disconnect-top').click();
  await expect(page.locator('#connection')).toHaveText('Disconnected');
  expect(await page.evaluate(() => failedRequest)).toContain('closed');
  await expect.poll(() => page.evaluate(() => serialMock.closes)).toBe(1);
  await page.locator('#connect').click();
  await expect(page.locator('#connection')).toHaveText('Connected via USB');
  expect(errors).toEqual([]);
});

test('switching USB to BLE on the same stable badge retains its draft', async ({ page }) => {
  const errors = await setup(page, { authorized: true });
  await expect(page.locator('#connection')).toHaveText('Connected via USB');
  await page.locator('#title').fill('Same physical badge');
  await page.evaluate(() => {
    bleMock.status.deviceId = '0123456789abcdef';
  });
  await page.locator('#disconnect-top').click();
  await expect(page.locator('#connection')).toHaveText('Disconnected');
  await page.locator('#choose-connection').click();
  await page.locator('#connect-bluetooth').click();
  await expect(page.locator('#connection')).toHaveText('Connected via Bluetooth');
  await expect(page.locator('#title')).toHaveValue('Same physical badge');
  expect(await page.evaluate(() => serialMock.closes)).toBe(1);
  expect(errors).toEqual([]);
});

test('artwork download shows real progress and replaces its placeholder', async ({ page }) => {
  const errors = await setup(page, { authorized: true });
  await expect(page.locator('#connection')).toHaveText('Connected via USB');
  await page.evaluate(() => {
    const rgba = new Uint8ClampedArray(240 * 320 * 4);
    for (let i = 0; i < rgba.length; i += 4) {
      rgba[i] = 90;
      rgba[i + 1] = 130;
      rgba[i + 2] = 180;
      rgba[i + 3] = 255;
    }
    bleMock.images['12345678'] = Array.from(new Uint8Array(BadgeCodec.encodeBMP(rgba)));
    bleMock.deck.cards[0].image = '12345678';
    bleMock.status.imageReadMax = 4096;
    bleMock.replyDelay = 30;
  });
  await page.locator('.storage summary').click();
  await page.locator('#reload').click();
  await expect(page.locator('#preview-placeholder')).toBeVisible();
  await expect(page.locator('#preview-help')).toContainText(/Loading card… \d+%/);
  for (const [width, theme] of [
    [390, 'light'],
    [1360, 'dark'],
  ]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.locator('#theme').selectOption(theme);
    await page.screenshot({
      path: `../test-results/usb-loading-${width}-${theme}.png`,
      fullPage: true,
    });
  }
  await expect(page.locator('#preview-placeholder')).not.toBeVisible({ timeout: 20000 });
  await expect(page.locator('#preview-help')).toHaveText('Drag artwork to position it.');
  expect(errors).toEqual([]);
});
