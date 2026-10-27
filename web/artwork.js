/* One transform pipeline for preview, pointer dragging and final export. */
(() => {
  'use strict';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function geometry(width, height, state, w = 240, h = 320) {
    const angle = (((state.rotation || 0) % 360) + 360) % 360;
    const swapped = angle === 90 || angle === 270;
    const iw = swapped ? height : width,
      ih = swapped ? width : height;
    const scale =
      (state.fit === 'contain' ? Math.min(w / iw, h / ih) : Math.max(w / iw, h / ih)) *
      Math.max(1, state.zoom);
    const dw = iw * scale,
      dh = ih * scale;
    // Positive position moves artwork right/down. +/-100 are allowed travel extremes.
    const rx = Math.abs(dw - w) / 2,
      ry = Math.abs(dh - h) / 2;
    return {
      angle,
      scale,
      w: dw,
      h: dh,
      rx,
      ry,
      cx: w / 2 + (rx * clamp(state.x, -100, 100)) / 100,
      cy: h / 2 + (ry * clamp(state.y, -100, 100)) / 100,
    };
  }
  function draw(context, image, state, background = '#000000') {
    context.save();
    context.fillStyle = background;
    context.fillRect(0, 0, 240, 320);
    const g = geometry(image.width, image.height, state);
    context.translate(g.cx, g.cy);
    context.rotate((g.angle * Math.PI) / 180);
    context.scale(g.scale, g.scale);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, -image.width / 2, -image.height / 2);
    context.restore();
    return g;
  }
  function move(state, g, dx, dy) {
    state.x = g.rx > 0.001 ? clamp(state.x + (dx / g.rx) * 100, -100, 100) : 0;
    state.y = g.ry > 0.001 ? clamp(state.y + (dy / g.ry) * 100, -100, 100) : 0;
  }
  globalThis.BadgeArtwork = { geometry, draw, move, clamp };
})();
