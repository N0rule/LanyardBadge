/* GIF preparation foundation. Not loaded by the release editor until device playback exists. */
(() => {
  'use strict';
  const limits = Object.freeze({
    bytes: 30 * 1024 * 1024,
    pixels: 16_000_000,
    frames: 300,
    durationMs: 30_000,
  });
  function header(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 13)
      throw Error('The GIF file is incomplete.');
    const signature = String.fromCharCode(...bytes.subarray(0, 6));
    if (signature !== 'GIF87a' && signature !== 'GIF89a') throw Error('Choose a valid GIF file.');
    const width = bytes[6] | (bytes[7] << 8),
      height = bytes[8] | (bytes[9] << 8);
    if (!width || !height || width * height > limits.pixels)
      throw Error('Choose a GIF below 16 megapixels.');
    return { width, height };
  }
  async function supported() {
    return typeof ImageDecoder !== 'undefined' && (await ImageDecoder.isTypeSupported('image/gif'));
  }
  function difference(previous, current, width = 240, height = 320) {
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 1 ||
      height < 1 ||
      width > 240 ||
      height > 320 ||
      !(current instanceof Uint16Array) ||
      current.length !== width * height ||
      (previous && (!(previous instanceof Uint16Array) || previous.length !== current.length))
    )
      throw Error('Invalid animation frame dimensions.');
    let left = width,
      top = height,
      right = -1,
      bottom = -1;
    if (!previous) {
      left = top = 0;
      right = width - 1;
      bottom = height - 1;
    } else
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const i = y * width + x;
          if (previous[i] !== current[i]) {
            left = Math.min(left, x);
            right = Math.max(right, x);
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
          }
        }
    if (right < left) return { x: 0, y: 0, width: 0, height: 0, pixels: new Uint16Array() };
    const w = right - left + 1,
      h = bottom - top + 1,
      pixels = new Uint16Array(w * h);
    for (let y = 0; y < h; y++)
      pixels.set(current.subarray((top + y) * width + left, (top + y) * width + left + w), y * w);
    return { x: left, y: top, width: w, height: h, pixels };
  }
  // The callback is awaited before decoding another frame. Retain only compressed output,
  // not every decoded source frame. An identical frame still carries its delay.
  async function prepare(
    blob,
    onFrame,
    {
      transform = { fit: 'cover', zoom: 1, x: 0, y: 0, rotation: 0 },
      background = '#f1f3f5',
      signal,
    } = {},
  ) {
    const state = { fit: 'cover', zoom: 1, x: 0, y: 0, rotation: 0, ...transform };
    if (
      ![state.zoom, state.x, state.y, state.rotation].every(Number.isFinite) ||
      state.zoom < 1 ||
      state.zoom > 3 ||
      state.rotation % 90 !== 0 ||
      !['cover', 'contain'].includes(state.fit)
    )
      throw Error('Invalid artwork adjustments.');
    if (typeof onFrame !== 'function') throw TypeError('A frame sink is required.');
    if (blob.size > limits.bytes) throw Error('Choose a GIF smaller than 30 MB.');
    signal?.throwIfAborted();
    const data = new Uint8Array(await blob.arrayBuffer()),
      dimensions = header(data);
    if (!(await supported())) throw Error('This browser cannot prepare animated GIFs.');
    signal?.throwIfAborted();
    // Snapshot edits so asynchronous callbacks cannot change the transform mid-animation.
    const decoder = new ImageDecoder({ type: 'image/gif', data, preferAnimation: true });
    const abort = () => decoder.close();
    signal?.addEventListener('abort', abort, { once: true });
    let previous,
      totalDurationMs = 0;
    try {
      const canvas = new OffscreenCanvas(240, 320),
        context = canvas.getContext('2d', { willReadFrequently: true });
      await decoder.tracks.ready;
      await decoder.completed;
      const track = decoder.tracks.selectedTrack;
      if (!track || !track.frameCount || track.frameCount > limits.frames)
        throw Error('Choose a GIF with 1–300 frames.');
      const metadata = {
        ...dimensions,
        frames: track.frameCount,
        repetitions: track.repetitionCount,
      };
      for (let index = 0; index < track.frameCount; index++) {
        signal?.throwIfAborted();
        const { image } = await decoder.decode({ frameIndex: index, completeFramesOnly: true });
        let bitmap;
        try {
          // ImageDecoder handles GIF transparency/disposal; the bitmap is the complete
          // composed frame. Draw through the same transform used by still artwork.
          bitmap = await createImageBitmap(image);
          signal?.throwIfAborted();
          if (bitmap.width !== dimensions.width || bitmap.height !== dimensions.height)
            throw Error('The GIF has inconsistent frame dimensions.');
          const durationMs = Math.max(20, Math.round((image.duration ?? 100_000) / 1000));
          totalDurationMs += durationMs;
          if (totalDurationMs > limits.durationMs)
            throw Error('Choose a GIF no longer than 30 seconds.');
          BadgeArtwork.draw(context, bitmap, state, background);
          const current = BadgeCodec.encodePixels(context.getImageData(0, 0, 240, 320).data);
          const region = difference(previous, current);
          await onFrame({ ...region, index, durationMs, frameCount: track.frameCount });
          previous = current;
        } finally {
          bitmap?.close();
          image.close();
        }
      }
      signal?.throwIfAborted();
      return { ...metadata, durationMs: totalDurationMs };
    } catch (error) {
      signal?.throwIfAborted();
      throw error;
    } finally {
      signal?.removeEventListener('abort', abort);
      decoder.close();
    }
  }
  globalThis.BadgeGIF = { header, supported, difference, prepare, limits };
})();
