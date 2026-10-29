const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const installMock = require('./ble-mock.cjs');
require('../web/codec.js');
const rgba = new Uint8ClampedArray(240 * 320 * 4);
for (let i = 0; i < rgba.length; i += 4) {
  rgba[i] = 210;
  rgba[i + 3] = 255;
}
const bytes = Array.from(new Uint8Array(BadgeCodec.encodeBMP(rgba)));
async function setup(page, extra = {}) {
  await require('./code-helper.cjs')(page);
  await page.addInitScript(installMock, {
    image: '12345678',
    images: { 12345678: bytes },
    mtu: 517,
    snapshot: true,
    ...extra,
  });
  await page.route('https://badge.test/**', (r) =>
    r.fulfill({
      path: path.resolve(
        __dirname,
        '../web',
        new URL(r.request().url()).pathname.replace(/^\/LanyardBadge\/?/, '') || 'index.html',
      ),
    }),
  );
  await page.goto('https://badge.test/LanyardBadge/#key=abcdefghijklmnop');
  await page.locator('#connect').click();
  await expect(page.locator('#studio')).toBeVisible();
  await page.waitForFunction(() => !!BadgeEditor.state);
}
test('committed animations survive refresh through the validated cache and variable-size range transport', async ({
  page,
}) => {
  const animation = Array.from(fs.readFileSync(path.join(__dirname, 'fixtures/animation.lba')));
  await setup(page, { images: { 12345678: animation }, ranges: true });
  await expect(page.locator('#artwork-status')).toHaveText('GIF animation · 3 frames');
  expect(
    await page.evaluate(() => bleMock.requests.filter((p) => p.startsWith('/api/image'))),
  ).toEqual(['/api/image?id=12345678&offset=0&length=96']);
  await page.reload();
  await expect(page.locator('#studio')).toBeVisible();
  await expect(page.locator('#artwork-status')).toHaveText('GIF animation · 3 frames');
  expect(await page.evaluate(() => bleMock.requests)).toEqual(['/api/pair']);
});
test('refresh reuses validated browser artwork with fresh metadata and no image transfer', async ({
  page,
}) => {
  await setup(page);
  expect(
    await page.evaluate(() => bleMock.requests.filter((p) => p.startsWith('/api/image')).length),
  ).toBe(1);
  expect(await page.evaluate(() => bleMock.requests.includes('/api/cards'))).toBe(false);
  const before = await page.locator('#preview').evaluate((c) => c.toDataURL());
  await page.reload();
  await expect(page.locator('#studio')).toBeVisible();
  await page.waitForFunction(() => !!BadgeEditor.state);
  expect(await page.evaluate(() => bleMock.requests)).toEqual(['/api/pair']);
  expect(await page.locator('#preview').evaluate((c) => c.toDataURL())).toBe(before);
});
test('cache isolates badge identity and credentials and detects corrupt bytes', async ({
  page,
}) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    const cache = new BadgeArtworkCache.ArtworkCache();
    const a = await cache.scope('one', 'secret-one'),
      b = await cache.scope('two', 'secret-one'),
      c = await cache.scope('one', 'secret-two');
    const bytes = await badgeDevice.getArtwork('12345678');
    await cache.put(a, '12345678', bytes);
    const isolated = !(await cache.get(b, '12345678')) && !(await cache.get(c, '12345678'));
    await cache.transaction('readwrite', (store) => {
      const r = store.get(a.key + '/12345678');
      r.onsuccess = () => {
        const value = r.result;
        new Uint8Array(value.bytes)[100] ^= 1;
        store.put(value);
      };
    });
    const fresh = new BadgeArtworkCache.ArtworkCache();
    return { isolated, corrupt: !(await fresh.get(a, '12345678')) };
  });
  expect(result).toEqual({ isolated: true, corrupt: true });
});
test('browser storage denial falls back to memory without failing connection or preview', async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(globalThis, 'indexedDB', {
      get() {
        throw new DOMException('Denied', 'SecurityError');
      },
    }),
  );
  await setup(page);
  await expect(page.locator('#connection')).toHaveText('Connected via Bluetooth');
});
test('ranged preview reads reconstruct exact pixels and let foreground requests run', async ({
  page,
}) => {
  await setup(page, { ranges: true });
  const paths = await page.evaluate(() =>
    bleMock.requests.filter((p) => p.startsWith('/api/image')),
  );
  expect(paths.length).toBeGreaterThan(1);
  expect(paths.every((p) => p.includes('&length='))).toBe(true);
  expect(
    await page
      .locator('#preview')
      .evaluate((c) => c.getContext('2d').getImageData(120, 160, 1, 1).data[0]),
  ).toBeGreaterThan(200);
  await page.evaluate(async () => {
    const order = [];
    let status;
    await badgeDevice.getArtwork('12345678', {
      rangeBytes: 4096,
      onProgress: (p) => {
        if (!status) {
          status = badgeDevice.getStatus().then(() => order.push('status'));
        }
      },
    });
    order.push('image');
    await status;
    window.rangeOrder = order;
  });
  expect(await page.evaluate(() => rangeOrder)).toEqual(['status', 'image']);
});
test('forget badge clears its persisted artwork cache', async ({ page }) => {
  await setup(page);
  await page.locator('#device-open').click();
  await page.locator('#forget-badge').click();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const c = new BadgeArtworkCache.ArtworkCache();
        return c.transaction('readonly', (store, result) => {
          const r = store.count();
          r.onsuccess = () => result(r.result);
        });
      }),
    )
    .toBe(0);
});

test('a changed asset ID loads fresh artwork while an unchanged collection reload stays cached', async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    bleMock.deck.cards[0].image = '87654321';
    bleMock.images['87654321'] = bleMock.images['12345678'].slice();
    bleMock.deck.revision++;
  });
  await page.locator('.storage summary').click();
  await page.locator('#reload').click();
  await page.waitForFunction(() => BadgeEditor.state?.assetId === '87654321');
  expect(
    await page.evaluate(() => bleMock.requests.filter((p) => p.startsWith('/api/image')).length),
  ).toBe(2);
  await page.locator('#reload').click();
  await page.waitForFunction(() => BadgeEditor.state?.assetId === '87654321');
  expect(
    await page.evaluate(() => bleMock.requests.filter((p) => p.startsWith('/api/image')).length),
  ).toBe(2);
});

test('client-prepared upload seeds the cache without reading the new artwork back from the badge', async ({
  page,
}) => {
  await setup(page);
  await page.locator('#zoom-value').fill('110');
  await page.locator('#save-card').click();
  await expect(page.locator('#save-state')).toHaveText('Card uploaded', { timeout: 15000 });
  await page.locator('.storage summary').click();
  await page.locator('#reload').click();
  await page.waitForFunction(() => BadgeEditor.state?.assetId === 'abcdef01');
  expect(
    await page.evaluate(() => bleMock.requests.filter((p) => p.startsWith('/api/image')).length),
  ).toBe(1);
});

test('a delayed cache response never replaces newer source artwork', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const original = BadgeArtworkCache.ArtworkCache.prototype.get;
    BadgeArtworkCache.ArtworkCache.prototype.get = async function (...args) {
      globalThis.cacheReadStarted = true;
      await new Promise((r) => {
        globalThis.releaseCacheRead = r;
      });
      return original.apply(this, args);
    };
  });
  await page.locator('details.storage summary').click();
  await page.locator('#reload').click();
  await page.waitForFunction(() => globalThis.cacheReadStarted);
  const source = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 640;
    c.height = 480;
    c.getContext('2d').fillRect(0, 0, 640, 480);
    return c.toDataURL().split(',')[1];
  });
  await page.locator('#image-file').setInputFiles({
    name: 'new.png',
    mimeType: 'image/png',
    buffer: Buffer.from(source, 'base64'),
  });
  await expect(page.locator('#crop-controls')).toBeEnabled();
  await page.evaluate(() => {
    globalThis.newSource = BadgeEditor.state.image;
    releaseCacheRead();
  });
  await page.waitForFunction(
    () => BadgeEditor.state?.image === newSource && BadgeEditor.state.image.width === 640,
  );
  expect(await page.evaluate(() => BadgeEditor.state.dirty)).toBe(true);
});

test('a canceled preview cannot report an old-session error over a replacement connection', async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    const original = BadgeArtworkCache.ArtworkCache.prototype.get;
    BadgeArtworkCache.ArtworkCache.prototype.get = function (...args) {
      BadgeArtworkCache.ArtworkCache.prototype.get = original;
      return new Promise((resolve, reject) => {
        globalThis.rejectOldPreview = reject;
      });
    };
  });
  await page.locator('details.storage summary').click();
  await page.locator('#reload').click();
  await page.waitForFunction(() => !!globalThis.rejectOldPreview);
  await page.evaluate(() => badgeDevice.disconnect());
  await page.locator('#connect').click();
  await expect(page.locator('#connection')).toHaveText('Connected via Bluetooth');
  await page.waitForFunction(() => !!BadgeEditor.state);
  await page.evaluate(() => rejectOldPreview(Error('Previous Bluetooth session closed.')));
  await expect(page.locator('#toast')).not.toContainText('Previous Bluetooth session closed.');
  await expect(page.locator('#preview-help')).not.toContainText('Preview unavailable');
});
