/* Native GIF compositing and bounded display-ready LBA1 animation assets. */
(() => {
  'use strict';
  const limits = Object.freeze({
    bytes: 30 * 1024 * 1024,
    pixels: 16_000_000,
    frames: 300,
    durationMs: 30_000,
    decodedPixels: 64_000_000,
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
      if (dimensions.width * dimensions.height * track.frameCount > limits.decodedPixels)
        throw Error('Choose a smaller GIF or fewer frames.');
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
  const maxBytes = 1024 * 1024;
  const crcTable = Uint32Array.from({ length: 256 }, (_, i) => {
    let n = i;
    for (let b = 0; b < 8; b++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
    return n >>> 0;
  });
  function crc(bytes) {
    let n = 0xffffffff;
    for (const b of bytes) n = (n >>> 8) ^ crcTable[(n ^ b) & 255];
    return ~n >>> 0;
  }
  function pack(pixels) {
    const runs = [];
    for (let i = 0; i < pixels.length;) {
      const color = pixels[i];
      let count = 1;
      while (i + count < pixels.length && pixels[i + count] === color && count < 65535) count++;
      runs.push(count, color);
      i += count;
    }
    const encoded = runs.length * 2 < pixels.length * 2,
      values = encoded ? runs : pixels,
      bytes = new Uint8Array(values.length * 2),
      view = new DataView(bytes.buffer);
    for (let i = 0; i < values.length; i++) view.setUint16(i * 2, values[i], true);
    return { encoding: Number(encoded), bytes };
  }
  function parse(buffer) {
    const fail = () => {
      throw Error('Invalid or damaged badge animation.');
    };
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 48 || buffer.byteLength > maxBytes)
      fail();
    const b = new Uint8Array(buffer),
      v = new DataView(buffer),
      u16 = (p) => v.getUint16(p, true),
      u32 = (p) => v.getUint32(p, true);
    if (
      String.fromCharCode(...b.subarray(0, 4)) !== 'LBA1' ||
      u16(4) !== 240 ||
      u16(6) !== 320 ||
      !u16(8) ||
      u16(8) > 300 ||
      u32(12) !== b.length ||
      u32(28) ||
      crc(b.subarray(0, 24)) !== u32(24) ||
      crc(b.subarray(32)) !== u32(20)
    )
      fail();
    const frames = [];
    let at = 32,
      durationMs = 0;
    for (let i = 0; i < u16(8); i++) {
      if (at + 16 > b.length) fail();
      const x = u16(at),
        y = u16(at + 2),
        width = u16(at + 4),
        height = u16(at + 6),
        durationMs = u16(at + 8),
        encoding = u16(at + 10),
        length = u32(at + 12),
        count = width * height;
      at += 16;
      if (
        x + width > 240 ||
        y + height > 320 ||
        durationMs < 20 ||
        durationMs > 30000 ||
        !width !== !height ||
        (!count && (x || y || length || encoding)) ||
        encoding > 1 ||
        (!encoding && length !== count * 2) ||
        (encoding && (!length || length % 4)) ||
        at + length > b.length ||
        (!i && (x || y || width !== 240 || height !== 320))
      )
        fail();
      if (encoding) {
        let decoded = 0;
        for (let p = at; p < at + length; p += 4) {
          if (!u16(p)) fail();
          decoded += u16(p);
          if (decoded > count) fail();
        }
        if (decoded !== count) fail();
      }
      frames.push({ x, y, width, height, durationMs, encoding, at, length });
      at += length;
    }
    for (const frame of frames) durationMs += frame.durationMs;
    if (at !== b.length || durationMs !== u32(16) || durationMs > 30000) fail();
    return { buffer, frames, plays: u16(10), durationMs, width: 240, height: 320 };
  }
  function paint(animation, index, context) {
    const f = animation.frames[index];
    if (!f.width) return;
    const view = new DataView(animation.buffer),
      data = context.createImageData(f.width, f.height);
    let p = f.at,
      remaining = 0,
      color;
    for (let i = 0; i < f.width * f.height; i++) {
      if (!f.encoding) {
        color = view.getUint16(p, true);
        p += 2;
      } else {
        if (!remaining) {
          remaining = view.getUint16(p, true);
          color = view.getUint16(p + 2, true);
          p += 4;
        }
        remaining--;
      }
      data.data[i * 4] = Math.round(((color >> 11) * 255) / 31);
      data.data[i * 4 + 1] = Math.round((((color >> 5) & 63) * 255) / 63);
      data.data[i * 4 + 2] = Math.round(((color & 31) * 255) / 31);
      data.data[i * 4 + 3] = 255;
    }
    context.putImageData(data, f.x, f.y);
  }
  async function encode(source, options = {}) {
    const parts = [];
    let size = 32;
    const sink = (f) => {
      const packed = pack(f.pixels),
        record = new Uint8Array(16 + packed.bytes.length),
        v = new DataView(record.buffer);
      [f.x, f.y, f.width, f.height, f.durationMs, packed.encoding].forEach((n, i) =>
        v.setUint16(i * 2, n, true),
      );
      v.setUint32(12, packed.bytes.length, true);
      record.set(packed.bytes, 16);
      size += record.length;
      if (size > maxBytes)
        throw Error('This animation is too large for the badge. Choose a shorter or simpler GIF.');
      parts.push(record);
      options.onProgress?.(Math.round(((f.index + 1) * 100) / f.frameCount));
    };
    let metadata;
    if (source instanceof Blob) metadata = await prepare(source, sink, options);
    else {
      const animation = parse(source),
        input = new OffscreenCanvas(240, 320),
        output = new OffscreenCanvas(240, 320),
        inputContext = input.getContext('2d'),
        outputContext = output.getContext('2d', { willReadFrequently: true });
      let previous;
      for (let index = 0; index < animation.frames.length; index++) {
        options.signal?.throwIfAborted();
        paint(animation, index, inputContext);
        BadgeArtwork.draw(
          outputContext,
          input,
          options.transform || { zoom: 1, x: 0, y: 0, fit: 'cover', rotation: 0 },
          options.background,
        );
        const pixels = BadgeCodec.encodePixels(outputContext.getImageData(0, 0, 240, 320).data);
        sink({
          ...difference(previous, pixels),
          index,
          frameCount: animation.frames.length,
          durationMs: animation.frames[index].durationMs,
        });
        previous = pixels;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      metadata = {
        frames: animation.frames.length,
        repetitions: animation.plays ? animation.plays - 1 : Infinity,
        durationMs: animation.durationMs,
      };
    }
    const bytes = new Uint8Array(size),
      v = new DataView(bytes.buffer);
    bytes.set(new TextEncoder().encode('LBA1'));
    v.setUint16(4, 240, true);
    v.setUint16(6, 320, true);
    v.setUint16(8, metadata.frames, true);
    v.setUint16(
      10,
      metadata.repetitions === Infinity ? 0 : Math.min(65535, metadata.repetitions + 1),
      true,
    );
    v.setUint32(12, size, true);
    v.setUint32(16, metadata.durationMs, true);
    let at = 32;
    for (const p of parts) {
      bytes.set(p, at);
      at += p.length;
    }
    v.setUint32(20, crc(bytes.subarray(32)), true);
    v.setUint32(24, crc(bytes.subarray(0, 24)), true);
    return bytes.buffer;
  }
  // One composited canvas and one decoder, never an array of decoded source frames.
  async function open(source) {
    let decoder, animation, track;
    const image = document.createElement('canvas');
    if (source instanceof Blob) {
      if (source.size > limits.bytes) throw Error('Choose a GIF smaller than 30 MB.');
      const data = new Uint8Array(await source.arrayBuffer()),
        dimensions = header(data);
      if (!(await supported())) throw Error('This browser cannot prepare animated GIFs.');
      decoder = new ImageDecoder({ type: 'image/gif', data, preferAnimation: true });
      try {
        await decoder.tracks.ready;
        await decoder.completed;
        track = decoder.tracks.selectedTrack;
        if (!track || !track.frameCount || track.frameCount > limits.frames)
          throw Error('Choose a GIF with 1–300 frames.');
        if (dimensions.width * dimensions.height * track.frameCount > limits.decodedPixels)
          throw Error('Choose a smaller GIF or fewer frames.');
      } catch (e) {
        decoder.close();
        throw e;
      }
      image.width = dimensions.width;
      image.height = dimensions.height;
    } else {
      animation = parse(source);
      image.width = 240;
      image.height = 320;
      track = {
        frameCount: animation.frames.length,
        repetitionCount: animation.plays ? animation.plays - 1 : Infinity,
      };
    }
    const ctx = image.getContext('2d');
    let index = 0,
      cycles = 0,
      timer,
      callback,
      closed = false,
      ended = false,
      generation = 0,
      delay = 100,
      decoding = Promise.resolve();
    async function decode(i, allowed = () => true) {
      if (animation) {
        paint(animation, i, ctx);
        return animation.frames[i].durationMs;
      }
      const { image: frame } = await decoder.decode({ frameIndex: i, completeFramesOnly: true });
      try {
        if (!allowed()) return delay;
        ctx.clearRect(0, 0, image.width, image.height);
        ctx.drawImage(frame, 0, 0);
        return Math.max(20, Math.round((frame.duration ?? 100000) / 1000));
      } finally {
        frame.close();
      }
    }
    const player = {
      get finished() {
        return ended;
      },
      restart() {
        player.pause();
        index = -1;
        cycles = 0;
        ended = false;
      },
      play(fn, onend) {
        if (closed || callback || ended) return;
        callback = fn;
        const gen = ++generation;
        const tick = async () => {
          if (closed || gen !== generation || !callback) return;
          let next = index + 1;
          if (next >= track.frameCount) {
            if (cycles >= track.repetitionCount) {
              callback = null;
              ended = true;
              onend?.();
              return;
            }
            cycles++;
            next = 0;
          }
          try {
            // A pause/resume can happen while native decode is still settling.
            delay = await (decoding = decoding.then(() =>
              closed || gen !== generation
                ? delay
                : decode(next, () => gen === generation && !closed),
            ));
            if (closed || gen !== generation || !callback) return;
            index = next;
            callback();
            timer = setTimeout(tick, delay);
          } catch {
            player.pause();
          }
        };
        timer = setTimeout(tick, delay);
      },
      pause() {
        clearTimeout(timer);
        callback = null;
        generation++;
      },
      close() {
        if (closed) return;
        player.pause();
        closed = true;
        decoder?.close();
      },
    };
    try {
      delay = await decode(0);
    } catch (error) {
      player.close();
      throw error;
    }
    image.close = player.close;
    return { image, player, animationSource: source, frames: track.frameCount };
  }
  globalThis.BadgeGIF = {
    header,
    supported,
    difference,
    prepare,
    limits,
    maxBytes,
    crc,
    pack,
    parse,
    paint,
    encode,
    open,
  };
})();
