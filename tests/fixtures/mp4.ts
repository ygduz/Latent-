/**
 * Minimal MP4 box writer for test fixtures.
 *
 * Lets the container checks be tested against structures built on purpose —
 * including malformed and audio-bearing ones that a correct encoder would never
 * produce — without needing a browser or a real encode.
 */

function ascii(text: string): Uint8Array {
  return new Uint8Array([...text].map((character) => character.charCodeAt(0)));
}

/** Concatenate byte runs. */
export function bytes(...parts: readonly (Uint8Array | number[])[]): Uint8Array {
  const runs = parts.map((part) => (part instanceof Uint8Array ? part : new Uint8Array(part)));
  const total = runs.reduce((sum, run) => sum + run.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const run of runs) {
    out.set(run, at);
    at += run.length;
  }
  return out;
}

export function uint32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value);
  return out;
}

/** A box: 4-byte size, 4-byte type, payload. */
export function box(type: string, ...payload: readonly (Uint8Array | number[])[]): Uint8Array {
  const body = bytes(...payload);
  return bytes(uint32(body.length + 8), ascii(type), body);
}

export function ftyp(major = 'isom', ...compatible: readonly string[]): Uint8Array {
  return box('ftyp', ascii(major), uint32(512), ...compatible.map((brand) => ascii(brand)));
}

/** A movie header declaring a duration. */
export function mvhd(durationSec: number, timescale = 1000): Uint8Array {
  return box(
    'mvhd',
    [0, 0, 0, 0], // version 0 + flags
    uint32(0), // creation
    uint32(0), // modification
    uint32(timescale),
    uint32(Math.round(durationSec * timescale)),
  );
}

interface TrackOptions {
  readonly handler: 'vide' | 'soun';
  readonly width?: number;
  readonly height?: number;
}

export function trak({ handler, width, height }: TrackOptions): Uint8Array {
  const fixed16 = (value: number) => uint32(Math.round(value * 65536));

  // tkhd version 0: version+flags, times, track id, reserved, duration,
  // reserved, layer, alternate group, volume, reserved, 9-entry matrix, then
  // width and height as the final eight bytes.
  const tkhd = box(
    'tkhd',
    [0, 0, 0, 0],
    uint32(0),
    uint32(0),
    uint32(1),
    uint32(0),
    uint32(0),
    new Uint8Array(8),
    new Uint8Array(4),
    new Uint8Array(4),
    new Uint8Array(36),
    fixed16(width ?? 0),
    fixed16(height ?? 0),
  );

  const hdlr = box('hdlr', [0, 0, 0, 0], uint32(0), ascii(handler), new Uint8Array(12));
  return box('trak', tkhd, box('mdia', hdlr));
}

/** A whole file: ftyp plus a moov containing the given tracks. */
export function mp4File(
  options: { readonly durationSec?: number; readonly tracks?: readonly TrackOptions[] } = {},
): Uint8Array {
  const { durationSec = 5, tracks = [{ handler: 'vide', width: 1080, height: 1920 }] } = options;
  return bytes(
    ftyp('isom', 'isom', 'avc1', 'mp42'),
    box('moov', mvhd(durationSec), ...tracks.map(trak)),
  );
}
