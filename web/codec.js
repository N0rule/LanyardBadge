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
  function rgb565(r, g, b) {
    return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
  }
  function encodePixels(rgba) {
    if (rgba.length !== W * H * 4) throw Error('A 240 × 320 image is required');
    const pixels = new Uint16Array(W * H);
    for (let i = 0; i < pixels.length; i++)
      pixels[i] = rgb565(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
    return pixels;
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
          px = rgb565(rgba[i], rgba[i + 1], rgba[i + 2]);
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
  globalThis.BadgeCodec = { cropRect, encodeBMP, decodeBMP, encodePixels, validateCard };
})();
