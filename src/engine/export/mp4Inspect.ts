/**
 * Minimal MP4 box reader.
 *
 * The validator's promise is that an upload will not be rejected, so it has to
 * check the bytes that were actually produced rather than the settings we asked
 * for. This reads just enough of the container to answer three questions: is it
 * an MP4, what tracks does it contain, and how long is it.
 *
 * Deliberately not a full parser — it walks only the boxes it needs and ignores
 * everything else.
 */

export class Mp4ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Mp4ParseError';
  }
}

export interface Mp4Track {
  /** Handler type: `vide` for video, `soun` for audio. */
  readonly handler: string;
  readonly width?: number;
  readonly height?: number;
}

export interface Mp4Info {
  readonly hasFtyp: boolean;
  readonly brands: readonly string[];
  readonly tracks: readonly Mp4Track[];
  readonly durationSec: number | null;
}

interface Box {
  readonly type: string;
  readonly start: number;
  readonly end: number;
}

const HEADER_BYTES = 8;

function readType(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

/** Walk the boxes directly inside a byte range. */
function* boxesIn(view: DataView, from: number, to: number): Generator<Box> {
  let offset = from;
  while (offset + HEADER_BYTES <= to) {
    let size = view.getUint32(offset);
    const type = readType(view, offset + 4);
    let contentStart = offset + HEADER_BYTES;

    if (size === 1) {
      // 64-bit size. Only the low half is usable in practice, and a file large
      // enough to need the high half is far outside anything this produces.
      if (contentStart + 8 > to) {
        throw new Mp4ParseError(`truncated 64-bit size in "${type}" box`);
      }
      const high = view.getUint32(contentStart);
      const low = view.getUint32(contentStart + 4);
      if (high !== 0) {
        throw new Mp4ParseError('box larger than 4 GiB');
      }
      size = low;
      contentStart += 8;
    } else if (size === 0) {
      // Extends to the end of the file.
      size = to - offset;
    }

    if (size < HEADER_BYTES) {
      throw new Mp4ParseError(`"${type}" box declares an impossible size of ${size}`);
    }
    const end = offset + size;
    if (end > to) {
      throw new Mp4ParseError(`"${type}" box runs past the end of its parent`);
    }

    yield { type, start: contentStart, end };
    offset = end;
  }
}

function findBox(view: DataView, from: number, to: number, type: string): Box | null {
  for (const box of boxesIn(view, from, to)) {
    if (box.type === type) {
      return box;
    }
  }
  return null;
}

/** 16.16 fixed-point, as `tkhd` stores dimensions. */
function readFixed16(view: DataView, offset: number): number {
  return view.getUint32(offset) / 65536;
}

function readTrack(view: DataView, trak: Box): Mp4Track | null {
  const mdia = findBox(view, trak.start, trak.end, 'mdia');
  if (!mdia) {
    return null;
  }
  const hdlr = findBox(view, mdia.start, mdia.end, 'hdlr');
  if (!hdlr || hdlr.start + 12 > hdlr.end) {
    return null;
  }
  // hdlr: version+flags (4), pre_defined (4), handler_type (4).
  const handler = readType(view, hdlr.start + 8);

  const tkhd = findBox(view, trak.start, trak.end, 'tkhd');
  if (!tkhd) {
    return { handler };
  }

  const version = view.getUint8(tkhd.start);
  // Width and height are the last eight bytes of tkhd, whatever the version.
  const dimensionsAt = tkhd.end - 8;
  if (dimensionsAt < tkhd.start || version > 1) {
    return { handler };
  }
  const width = readFixed16(view, dimensionsAt);
  const height = readFixed16(view, dimensionsAt + 4);

  return width > 0 && height > 0 ? { handler, width, height } : { handler };
}

function readDurationSec(view: DataView, moov: Box): number | null {
  const mvhd = findBox(view, moov.start, moov.end, 'mvhd');
  if (!mvhd) {
    return null;
  }
  const version = view.getUint8(mvhd.start);
  // version+flags (4), then creation and modification times, then timescale
  // and duration. The times are 4 bytes each in version 0 and 8 in version 1.
  const timesBytes = version === 1 ? 16 : 8;
  const timescaleAt = mvhd.start + 4 + timesBytes;

  if (version === 1) {
    if (timescaleAt + 12 > mvhd.end) {
      return null;
    }
    const timescale = view.getUint32(timescaleAt);
    const high = view.getUint32(timescaleAt + 4);
    const low = view.getUint32(timescaleAt + 8);
    const duration = high * 2 ** 32 + low;
    return timescale > 0 ? duration / timescale : null;
  }

  if (timescaleAt + 8 > mvhd.end) {
    return null;
  }
  const timescale = view.getUint32(timescaleAt);
  const duration = view.getUint32(timescaleAt + 4);
  return timescale > 0 ? duration / timescale : null;
}

export function inspectMp4(bytes: Uint8Array): Mp4Info {
  if (bytes.byteLength < HEADER_BYTES) {
    throw new Mp4ParseError('too short to be an MP4');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let hasFtyp = false;
  const brands: string[] = [];
  const tracks: Mp4Track[] = [];
  let durationSec: number | null = null;

  for (const box of boxesIn(view, 0, bytes.byteLength)) {
    if (box.type === 'ftyp') {
      hasFtyp = true;
      // Major brand, minor version, then compatible brands.
      for (let at = box.start; at + 4 <= box.end; at += 4) {
        if (at !== box.start + 4) {
          brands.push(readType(view, at));
        }
      }
      continue;
    }

    if (box.type === 'moov') {
      durationSec = readDurationSec(view, box);
      for (const child of boxesIn(view, box.start, box.end)) {
        if (child.type === 'trak') {
          const track = readTrack(view, child);
          if (track) {
            tracks.push(track);
          }
        }
      }
    }
  }

  return { hasFtyp, brands, tracks, durationSec };
}
