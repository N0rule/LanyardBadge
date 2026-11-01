/* Native GIF compositing and bounded display-ready LBA1 animation assets. */
(() => {
  'use strict';
  const limits = Object.freeze({
    bytes: 100 * 1024 * 1024,
    pixels: 16_000_000,
    frames: 2000,
    durationMs: 180_000,
    decodedPixels: 128_000_000,
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
    if (blob.size > limits.bytes) throw Error('Choose a GIF smaller than 100 MB.');
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
        throw Error('Choose a GIF with 1–2000 frames.');
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
            throw Error('Choose a GIF no longer than 180 seconds.');
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
  const maxBytes = 1536 * 1024;
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
  // RGB565 dictionary codec: literal words or overlapping backreferences.
  // Window is 4096 pixels so firmware needs only 8 KiB of history.
  function dictionary(pixels) {
    const output = [],
      table = new Int32Array(65536).fill(-1);
    const emit = (n) => output.push(n & 255, n >>> 8);
    let anchor = 0,
      i = 0;
    const literal = (end) => {
      while (anchor < end) {
        const n = Math.min(32768, end - anchor);
        emit(n - 1);
        for (let k = 0; k < n; k++) emit(pixels[anchor++]);
      }
    };
    while (i + 3 < pixels.length) {
      const hash = (((pixels[i] * 31) ^ (pixels[i + 1] * 17) ^ pixels[i + 2]) >>> 0) & 65535;
      const previous = table[hash];
      table[hash] = i;
      let n = 0;
      if (previous >= 0 && i - previous <= 4096)
        while (n < 32770 && i + n < pixels.length && pixels[previous + n] === pixels[i + n]) n++;
      if (n >= 4) {
        literal(i);
        emit(0x8000 | (n - 3));
        emit(i - previous);
        i += n;
        anchor = i;
      } else i++;
    }
    literal(pixels.length);
    return Uint8Array.from(output);
  }
  function unpackDictionary(bytes, count) {
    const pixels = new Uint16Array(count),
      view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let at = 0,
      out = 0;
    const word = () => {
      if (at + 2 > bytes.length) throw Error('Truncated compressed artwork');
      const n = view.getUint16(at, true);
      at += 2;
      return n;
    };
    while (at < bytes.length) {
      const token = word(),
        n = (token & 32767) + (token & 32768 ? 3 : 1);
      if (out + n > count) throw Error('Compressed artwork exceeds frame');
      if (token & 32768) {
        const distance = word();
        if (!distance || distance > 4096 || distance > out)
          throw Error('Invalid artwork reference');
        for (let k = 0; k < n; k++, out++) pixels[out] = pixels[out - distance];
      } else for (let k = 0; k < n; k++) pixels[out++] = word();
    }
    if (out !== count) throw Error('Incomplete compressed artwork');
    return pixels;
  }
  function pack(pixels, compressed = true) {
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
    const compact = compressed && pixels.length ? dictionary(pixels) : null;
    return compact && compact.length < bytes.length
      ? { encoding: 2, bytes: compact }
      : { encoding: Number(encoded), bytes };
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
      u16(8) > 2000 ||
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
        encoding > 2 ||
        (!encoding && length !== count * 2) ||
        (encoding === 1 && (!length || length % 4)) ||
        at + length > b.length ||
        (!i && (x || y || width !== 240 || height !== 320))
      )
        fail();
      if (encoding === 2) unpackDictionary(b.subarray(at, at + length), count);
      if (encoding === 1) {
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
    if (at !== b.length || durationMs !== u32(16) || durationMs > 180000) fail();
    return { buffer, frames, plays: u16(10), durationMs, width: 240, height: 320 };
  }
  function paint(animation, index, context) {
    const f = animation.frames[index];
    if (!f.width) return;
    const view = new DataView(animation.buffer),
      data = context.createImageData(f.width, f.height);
    const dictionaryPixels =
      f.encoding === 2
        ? unpackDictionary(new Uint8Array(animation.buffer, f.at, f.length), f.width * f.height)
        : null;
    let p = f.at,
      remaining = 0,
      color;
    for (let i = 0; i < f.width * f.height; i++) {
      if (dictionaryPixels) color = dictionaryPixels[i];
      else if (!f.encoding) {
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
      const packed = pack(f.pixels, options.compressed !== false),
        record = new Uint8Array(16 + packed.bytes.length),
        v = new DataView(record.buffer);
      [f.x, f.y, f.width, f.height, Math.min(f.durationMs, 30000), packed.encoding].forEach(
        (n, i) => v.setUint16(i * 2, n, true),
      );
      v.setUint32(12, packed.bytes.length, true);
      record.set(packed.bytes, 16);
      size += record.length;
      if (size > maxBytes)
        throw Error('This animation is too large for the badge. Choose a shorter or simpler GIF.');
      parts.push(record);
      let remaining = f.durationMs - 30000;
      while (remaining > 0) {
        const hold = new Uint8Array(16);
        new DataView(hold.buffer).setUint16(8, Math.min(remaining, 30000), true);
        parts.push(hold);
        size += 16;
        remaining -= 30000;
      }
      if (parts.length > 2000 || size > maxBytes)
        throw Error('Prepared artwork exceeds the badge storage or frame limit.');
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
    v.setUint16(8, parts.length, true);
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
      if (source.size > limits.bytes) throw Error('Choose a GIF smaller than 100 MB.');
      const data = new Uint8Array(await source.arrayBuffer()),
        dimensions = header(data);
      if (!(await supported())) throw Error('This browser cannot prepare animated GIFs.');
      decoder = new ImageDecoder({ type: 'image/gif', data, preferAnimation: true });
      try {
        await decoder.tracks.ready;
        await decoder.completed;
        track = decoder.tracks.selectedTrack;
        if (!track || !track.frameCount || track.frameCount > limits.frames)
          throw Error('Choose a GIF with 1–2000 frames.');
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
    dictionary,
    unpackDictionary,
    still(pixels) {
      const packed = pack(pixels),
        bytes = new Uint8Array(48 + packed.bytes.length),
        v = new DataView(bytes.buffer);
      bytes.set(new TextEncoder().encode('LBA1'));
      v.setUint16(4, 240, true);
      v.setUint16(6, 320, true);
      v.setUint16(8, 1, true);
      v.setUint16(10, 1, true);
      v.setUint32(12, bytes.length, true);
      v.setUint32(16, 100, true);
      v.setUint16(36, 240, true);
      v.setUint16(38, 320, true);
      v.setUint16(40, 100, true);
      v.setUint16(42, packed.encoding, true);
      v.setUint32(44, packed.bytes.length, true);
      bytes.set(packed.bytes, 48);
      v.setUint32(20, crc(bytes.subarray(32)), true);
      v.setUint32(24, crc(bytes.subarray(0, 24)), true);
      return bytes.buffer;
    },
    parse,
    paint,
    encode,
    open,
  };
})();
