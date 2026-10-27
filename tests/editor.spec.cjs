const { test, expect } = require('@playwright/test');
const fs = require('node:fs'),
  path = require('node:path');
const root = path.resolve(__dirname, '..');
const initial = {
  version: 2,
  revision: 1,
  cards: [
    {
      id: '00000001',
      title: 'Hello, I am N0rule',
      mode: 'profile',
      image: '',
      name: 'N0rule',
      description: 'Code, art and curious ideas.',
      url: 'https://n0rule.is-a.dev',
      background: 0xd9ceff,
      foreground: 0x23324d,
      accent: 0x3659d9,
      texts: [],
      shapes: [],
    },
    {
      id: '00000002',
      title: 'Make something',
      mode: 'custom',
      image: '',
      name: '',
      description: '',
      url: '',
      background: 0x3659d9,
      foreground: 0xffffff,
      accent: 0xd9ceff,
      texts: [{ text: 'Make something.', x: 20, y: 70, size: 28, color: 0xffffff }],
      shapes: [],
    },
  ],
};
async function setup(page, { mobile = false } = {}) {
  if (mobile) await page.setViewportSize({ width: 390, height: 844 });
  else await page.setViewportSize({ width: 1360, height: 1000 });
  const state = {
    deck: structuredClone(initial),
    selected: 0,
    uploads: [],
    settings: null,
    network: null,
    failSave: false,
    errors: [],
    stationConnected: false,
    stationIp: '',
    screen: 'connection',
  };
  page.on('pageerror', (e) => state.errors.push(e.message));
  const status = () => ({
    firmware: '2.0.0',
    heap: 120000,
    minHeap: 98000,
    largestBlock: 75000,
    psram: 0,
    storageReady: true,
    storageTotal: 2031616,
    storageUsed: 200000,
    selected: state.selected,
    brightness: 65,
    interval: 15,
    autoplay: false,
    rotation: 0,
    defaultCard: '00000001',
    calibrated: false,
    stationConnected: state.stationConnected,
    stationSsid: state.network?.ssid || '',
    stationIp: state.stationIp,
    apIp: '192.168.4.1',
    setupActive: true,
    screen: state.screen,
    setupSeconds: 850,
  });
  await page.route('**/*', async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    if (url.hostname !== 'badge.test') {
      state.errors.push('External request ' + req.url());
      await route.abort();
      return;
    }
    const send = (body, code = 200) =>
      route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.startsWith('/api/')) {
      const body = req.postDataJSON?.bind(req);
      if (url.pathname === '/api/pair')
        return body().password === 'test-password'
          ? send({ token: 'test-session' })
          : send({ error: 'Password does not match the badge' }, 401);
      if (req.headers().authorization !== 'Bearer test-session')
        return send({ error: 'Pair again' }, 401);
      if (url.pathname === '/api/status') return send(status());
      if (url.pathname === '/api/cards') {
        if (req.method() === 'GET') return send(state.deck);
        if (state.failSave) {
          state.failSave = false;
          return send({ error: 'Cards changed. Reload before saving.' }, 409);
        }
        const next = body();
        next.revision = state.deck.revision + 1;
        state.deck = next;
        return send(next);
      }
      if (url.pathname === '/api/select') {
        state.selected = state.deck.cards.findIndex((c) => c.id === body().id);
        return send(status());
      }
      if (url.pathname === '/api/assets') {
        state.uploads.push(req.postDataBuffer());
        return send({ id: 'ab00000' + state.uploads.length }, 201);
      }
      if (url.pathname === '/api/gc') return send({ removed: 0 });
      if (url.pathname === '/api/settings') {
        state.settings = body();
        return send({ ...status(), ...state.settings });
      }
      if (url.pathname === '/api/network') {
        state.network = body();
        return send(status());
      }
      if (url.pathname === '/api/calibrate') {
        state.calibrating = true;
        return send({ ok: true });
      }
      if (url.pathname === '/api/display') {
        state.screen = 'badge';
        return send({ ok: true });
      }
      if (url.pathname === '/api/close') return send({ ok: true });
      return send({ error: 'Not found' }, 404);
    }
    const map = {
      '/': 'index.html',
      '/style.css': 'style.css',
      '/app.js': 'app.js',
      '/qrcode.js': 'qrcode.js',
      '/font.woff2': 'Montserrat.woff2',
    };
    const file = map[url.pathname];
    if (!file) return route.fulfill({ status: 404 });
    const mime = file.endsWith('.js')
      ? 'text/javascript'
      : file.endsWith('.css')
        ? 'text/css'
        : file.endsWith('.woff2')
          ? 'font/woff2'
          : 'text/html';
    return route.fulfill({
      contentType: mime,
      body: fs.readFileSync(path.join(root, 'web', file)),
    });
  });
  await page.goto('http://badge.test/');
  return state;
}
async function pair(page) {
  await page.locator('#pair-password').fill('test-password');
  await page.getByRole('button', { name: 'Connect to badge', exact: true }).click();
  await expect(page.locator('#pair-dialog')).not.toBeVisible();
  await expect(page.locator('#card-count')).toHaveText('2 / 10');
}
async function addImage(page) {
  const data = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 300;
    c.height = 200;
    const x = c.getContext('2d');
    x.fillStyle = 'red';
    x.fillRect(0, 0, 150, 200);
    x.fillStyle = 'blue';
    x.fillRect(150, 0, 150, 200);
    return c.toDataURL('image/png').split(',')[1];
  });
  await page
    .locator('#image-file')
    .setInputFiles({ name: 'art.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64') });
  await expect(page.locator('#crop-controls')).toBeVisible();
}
test('pairs, edits profile and sends a persistent card', async ({ page }) => {
  const s = await setup(page);
  await page.locator('#pair-password').fill('bad');
  await page.getByRole('button', { name: 'Connect to badge', exact: true }).click();
  await expect(page.locator('#pair-error')).toContainText('does not match');
  await pair(page);
  await page.locator('#name').fill('Ada');
  await page.locator('#description').fill('A maker of small things.');
  await page.locator('#save-card').click();
  await expect(page.locator('#save-state')).toHaveText('All changes saved');
  expect(s.deck.cards[0].name).toBe('Ada');
  expect(s.errors).toEqual([]);
});
test('creates, reorders and deletes gallery cards', async ({ page }) => {
  const s = await setup(page);
  await pair(page);
  await page.locator('#new-card').click();
  await page.locator('#title').fill('Third card');
  await page.locator('#move-up').click();
  await page.locator('#save-card').click();
  await expect(page.locator('#save-state')).toHaveText('All changes saved');
  expect(s.deck.cards[1].title).toBe('Third card');
  page.on('dialog', (d) => d.accept());
  await page.locator('#delete-card').click();
  await page.locator('#save-card').click();
  await expect(page.locator('#card-count')).toHaveText('2 / 10');
  expect(s.errors).toEqual([]);
});
test('prepares a cropped RGB565 image and retries a failed manifest save', async ({ page }) => {
  const s = await setup(page);
  await pair(page);
  await page.locator('#mode').selectOption('artwork');
  await addImage(page);
  await page.locator('#zoom').fill('150');
  await page.locator('#crop-x').fill('50');
  s.failSave = true;
  await page.locator('#save-card').click();
  await expect(page.locator('#toast')).toContainText('Cards changed');
  await expect(page.locator('#save-state')).toHaveText('Unsaved changes');
  await page.locator('#save-card').click();
  await expect(page.locator('#save-state')).toHaveText('All changes saved');
  expect(s.uploads).toHaveLength(2);
  expect(s.uploads[0].length).toBe(153666);
  expect(s.uploads[0].readUInt32LE(54)).toBe(0xf800);
  expect(s.deck.cards[0].image).toBe('ab000002');
  expect(s.errors).toEqual([]);
});
test('custom text and graphics retain editable positions', async ({ page }) => {
  const s = await setup(page);
  await pair(page);
  await page.locator('.gallery-card').nth(1).click();
  await page.locator('#add-shape').click();
  await page.locator('#shapes').getByLabel('Width', { exact: true }).fill('100');
  const box = await page.locator('#preview').boundingBox();
  await page.mouse.move(box.x + 35, box.y + 35);
  await page.mouse.down();
  await page.mouse.move(box.x + 65, box.y + 55);
  await page.mouse.up();
  await page.locator('#save-card').click();
  await expect(page.locator('#save-state')).toHaveText('All changes saved');
  expect(s.deck.cards[1].shapes[0]).toMatchObject({ x: 50, y: 40, w: 100 });
  expect(s.errors).toEqual([]);
});
test('saves display settings and Wi-Fi without sending credentials to other origins', async ({
  page,
}) => {
  const s = await setup(page);
  await pair(page);
  await page.locator('#device-open').click();
  await page.locator('#brightness').fill('80');
  await page.locator('#autoplay').check();
  await page.locator('#interval').fill('30');
  await page.getByRole('button', { name: 'Save device settings' }).click();
  await expect(page.locator('#toast')).toContainText('Device settings saved');
  expect(s.settings).toMatchObject({ brightness: 80, autoplay: true, interval: 30 });
  await page.getByText('Wi-Fi network', { exact: true }).click();
  await page.locator('#wifi-ssid').fill('Private LAN');
  await page.locator('#wifi-password').fill('private-password');
  await page.getByRole('button', { name: 'Save network', exact: true }).click();
  await expect(page.locator('#wifi-password')).toHaveValue('');
  expect(s.network.ssid).toBe('Private LAN');
  expect(s.errors).toEqual([]);
});
test('mobile layout stays within viewport and exposes gallery controls', async ({ page }) => {
  const s = await setup(page, { mobile: true });
  await pair(page);
  await expect(page.locator('#move-up')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: path.join(root, 'test-results/editor-mobile.png'),
    fullPage: true,
  });
  expect(s.errors).toEqual([]);
});
test('desktop editor renders offline without script errors', async ({ page }) => {
  const s = await setup(page);
  await pair(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: path.join(root, 'test-results/editor-desktop.png'),
    fullPage: true,
  });
  expect(s.errors).toEqual([]);
});

test('starts physical touch calibration from a phone browser', async ({ page }) => {
  const s = await setup(page, { mobile: true });
  await pair(page);
  await page.locator('#device-open').click();
  await page.locator('#calibrate-touch').click();
  await expect(page.locator('#device-dialog')).not.toBeVisible();
  expect(s.calibrating).toBe(true);
  expect(s.errors).toEqual([]);
});

test('shows the badge without closing the editor or losing unsaved edits', async ({ page }) => {
  const s = await setup(page, { mobile: true });
  await pair(page);
  await page.locator('#name').fill('Still editing');
  await page.locator('#show-badge').click();
  await expect(page.locator('#toast')).toContainText('You can keep editing');
  expect(s.screen).toBe('badge');
  await expect(page.locator('#name')).toHaveValue('Still editing');
  await expect(page.locator('#save-state')).toHaveText('Unsaved changes');
  await page.locator('#save-card').click();
  await expect(page.locator('#save-state')).toHaveText('All changes saved');
  expect(s.deck.cards[0].name).toBe('Still editing');
  expect(s.errors).toEqual([]);
});

test('guides Android hotspot setup and exposes the actual network editor address', async ({
  page,
}) => {
  const s = await setup(page, { mobile: true });
  await pair(page);
  await expect(page.locator('#connection-guide')).toBeVisible();
  await page.locator('#connect-network').click();
  await expect(page.locator('#wifi-ssid')).toBeFocused();
  await page.locator('#wifi-ssid').fill('My Android');
  await page.locator('#wifi-password').fill('private-password');
  await page.getByRole('button', { name: 'Save network', exact: true }).click();
  await expect(page.locator('#network-status')).toContainText('turn your hotspot on now');
  await expect(page.locator('#wifi-password')).toHaveValue('');
  s.stationConnected = true;
  s.stationIp = '192.168.43.27';
  await page.getByRole('button', { name: 'Save device settings' }).click();
  await expect(page.locator('#network-status')).toContainText('http://192.168.43.27');
  await page.locator('#device-close').click();
  await expect(page.locator('#connection-guide')).not.toBeVisible();
  expect(s.errors).toEqual([]);
});
