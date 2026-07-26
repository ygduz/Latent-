/**
 * Minimal PNG encoder for test fixtures.
 *
 * Exists so browser tests can upload real image bytes without committing binary
 * files or pulling in an image dependency. Deterministic: the same inputs always
 * produce the same bytes.
 *
 * Deliberately dependency-free — no `node:zlib` — so it runs unchanged in both
 * Vitest and the browser, and so the project needs no Node type definitions.
 * Compression uses zlib *stored* blocks: valid, byte-aligned, and trivial to
 * get right. Fixtures are tiny, so not compressing costs nothing.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) {
    c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/**
 * Wrap raw bytes in a zlib stream using stored (uncompressed) deflate blocks.
 * Stored blocks are byte-aligned, so no bit packing is involved.
 */
function zlibStored(data: Uint8Array): Uint8Array {
  const MAX_BLOCK = 0xffff;
  const blockCount = Math.max(1, Math.ceil(data.length / MAX_BLOCK));

  // 2-byte header + per-block 5-byte header + payload + 4-byte Adler-32.
  const out = new Uint8Array(2 + blockCount * 5 + data.length + 4);
  let at = 0;

  out[at] = 0x78; // deflate, 32K window
  out[at + 1] = 0x01; // no preset dictionary, fastest level
  at += 2;

  for (let block = 0; block < blockCount; block += 1) {
    const start = block * MAX_BLOCK;
    const len = Math.min(MAX_BLOCK, data.length - start);
    const isFinal = block === blockCount - 1;

    out[at] = isFinal ? 1 : 0; // BFINAL, BTYPE=00 (stored)
    out[at + 1] = len & 0xff;
    out[at + 2] = (len >>> 8) & 0xff;
    out[at + 3] = ~len & 0xff;
    out[at + 4] = (~len >>> 8) & 0xff;
    at += 5;

    out.set(data.subarray(start, start + len), at);
    at += len;
  }

  new DataView(out.buffer).setUint32(at, adler32(data));
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new Uint8Array([...type].map((ch) => ch.charCodeAt(0)));
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);

  const out = new Uint8Array(4 + body.length + 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(body, 4);
  view.setUint32(4 + body.length, crc32(body));
  return out;
}

export type PixelFn = (x: number, y: number) => readonly [number, number, number, number];

/** Encode an RGBA image as a PNG. */
export function encodePng(width: number, height: number, pixel: PixelFn): Uint8Array {
  // Each row is prefixed with filter type 0 (none).
  const raw = new Uint8Array(height * (1 + width * 4));
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    raw[offset] = 0;
    offset += 1;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = pixel(x, y);
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
      offset += 4;
    }
  }

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts = [
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibStored(raw)),
    chunk('IEND', new Uint8Array(0)),
  ];

  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const png = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    png.set(part, at);
    at += part.length;
  }
  return png;
}

/**
 * A square test cover: four distinct quadrants. Distinct quadrants make it
 * possible to assert *which* part of the artwork a given frame position shows,
 * so crop and letterbox bugs cannot hide.
 */
export function quadrantCover(size: number): Uint8Array {
  return encodePng(size, size, (x, y) => {
    const right = x >= size / 2;
    const bottom = y >= size / 2;
    if (!right && !bottom) return [220, 60, 60, 255]; // top-left: red
    if (right && !bottom) return [60, 200, 90, 255]; // top-right: green
    if (!right && bottom) return [70, 110, 230, 255]; // bottom-left: blue
    return [230, 200, 70, 255]; // bottom-right: yellow
  });
}
