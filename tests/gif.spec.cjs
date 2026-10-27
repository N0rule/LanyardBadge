const { test, expect } = require('@playwright/test');
const fs = require('node:fs'),
  path = require('node:path');
const root = path.resolve(__dirname, '../web');
const gif = fs.readFileSync(path.join(__dirname, 'fixtures/disposal.gif')).toString('base64');
const oracle = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/disposal.json')));
async function setup(page) {
  await page.route('https://badge.test/**', (r) =>
    r.fulfill({
      path: path.join(
        root,
        new URL(r.request().url()).pathname.replace(/^\/LanyardBadge\/?/, '') || 'index.html',
      ),
    }),
  );
  await page.goto('https://badge.test/LanyardBadge/');
  await page.addScriptTag({ url: 'https://badge.test/LanyardBadge/gif.js' });
  expect(await page.evaluate(() => BadgeGIF.supported())).toBe(true);
}
test('native GIF decoding preserves disposal, delays, loop count and shared artwork transforms', async ({
  page,
}) => {
  await setup(page);
  const report = await page.evaluate(
    async ({ gif, oracle }) => {
      const blob = new Blob([Uint8Array.from(atob(gif), (c) => c.charCodeAt(0))], {
          type: 'image/gif',
        }),
        frames = [];
      const state = { fit: 'contain', zoom: 1.25, x: 20, y: -35, rotation: 90 };
      let live = 0,
        maxLive = 0;
      const composed = new Uint16Array(240 * 320),
        snapshots = [];
      const metadata = await BadgeGIF.prepare(
        blob,
        async (frame) => {
          live++;
          maxLive = Math.max(live, maxLive);
          for (let y = 0; y < frame.height; y++)
            composed.set(
              frame.pixels.subarray(y * frame.width, (y + 1) * frame.width),
              (frame.y + y) * 240 + frame.x,
            );
          snapshots.push(composed.slice());
          frames.push({ delay: frame.durationMs, area: frame.width * frame.height });
          await new Promise((r) => setTimeout(r, 5));
          live--;
        },
        { transform: state, background: '#f1f3f5' },
      );
      const c = new OffscreenCanvas(240, 320),
        ctx = c.getContext('2d');
      const mismatches = [];
      for (let i = 0; i < oracle.rgba.length; i++) {
        const bitmap = await createImageBitmap(
          new ImageData(new Uint8ClampedArray(oracle.rgba[i]), 8, 8),
        );
        BadgeArtwork.draw(ctx, bitmap, state, '#f1f3f5');
        bitmap.close();
        const expected = BadgeCodec.encodePixels(ctx.getImageData(0, 0, 240, 320).data);
        mismatches.push(expected.reduce((n, p, j) => n + (p !== snapshots[i][j]), 0));
      }
      return { metadata, frames, mismatches, maxLive };
    },
    { gif, oracle },
  );
  expect(report.metadata).toEqual({
    width: 8,
    height: 8,
    frames: 4,
    repetitions: 2,
    durationMs: 560,
  });
  expect(report.frames.map((f) => f.delay)).toEqual([80, 120, 160, 200]);
  expect(report.mismatches).toEqual([0, 0, 0, 0]);
  expect(report.maxLive).toBe(1);
  expect(report.frames[0].area).toBe(240 * 320);
  expect(report.frames.slice(1).some((f) => f.area < 240 * 320)).toBe(true);
});
test('GIF preparation cancels after one frame and releases native decode resources', async ({
  page,
}) => {
  await setup(page);
  const result = await page.evaluate(async (gif) => {
    const blob = new Blob([Uint8Array.from(atob(gif), (c) => c.charCodeAt(0))]),
      controller = new AbortController();
    let count = 0,
      closed = 0;
    const close = ImageDecoder.prototype.close;
    ImageDecoder.prototype.close = function () {
      closed++;
      return close.call(this);
    };
    try {
      await BadgeGIF.prepare(
        blob,
        () => {
          count++;
          controller.abort();
        },
        { signal: controller.signal },
      );
      return { error: 'No cancellation' };
    } catch (e) {
      return { error: e.name, count, closed };
    } finally {
      ImageDecoder.prototype.close = close;
    }
  }, gif);
  expect(result.error).toBe('AbortError');
  expect(result.count).toBe(1);
  expect(result.closed).toBeGreaterThanOrEqual(1);
});
test('GIF preparation rejects unsupported decoding and oversized input without fake frames', async ({
  page,
}) => {
  await setup(page);
  const result = await page.evaluate(async (gif) => {
    const blob = new Blob([Uint8Array.from(atob(gif), (c) => c.charCodeAt(0))]);
    let frames = 0;
    const Decoder = ImageDecoder;
    globalThis.ImageDecoder = undefined;
    let unsupported, oversized;
    try {
      await BadgeGIF.prepare(blob, () => frames++);
    } catch (e) {
      unsupported = e.message;
    } finally {
      globalThis.ImageDecoder = Decoder;
    }
    try {
      await BadgeGIF.prepare(new Blob([new Uint8Array(30 * 1024 * 1024 + 1)]), () => frames++);
    } catch (e) {
      oversized = e.message;
    }
    return { unsupported, oversized, frames };
  }, gif);
  expect(result.unsupported).toContain('cannot prepare');
  expect(result.oversized).toContain('smaller than 30 MB');
  expect(result.frames).toBe(0);
});
