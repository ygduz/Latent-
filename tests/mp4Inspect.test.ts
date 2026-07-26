import { describe, expect, it } from 'vitest';
import { Mp4ParseError, inspectMp4 } from '../src/engine/export/mp4Inspect';
import { box, bytes, ftyp, mp4File, mvhd, trak, uint32 } from './fixtures/mp4';

describe('inspectMp4', () => {
  it('reads brands, tracks and duration from a well-formed file', () => {
    const info = inspectMp4(mp4File({ durationSec: 5 }));

    expect(info.hasFtyp).toBe(true);
    expect(info.brands).toContain('avc1');
    expect(info.brands).toContain('mp42');
    expect(info.durationSec).toBeCloseTo(5, 3);
    expect(info.tracks).toHaveLength(1);
    expect(info.tracks[0]?.handler).toBe('vide');
  });

  it('reads the frame size from the track header', () => {
    const info = inspectMp4(mp4File({ tracks: [{ handler: 'vide', width: 1080, height: 1920 }] }));
    expect(info.tracks[0]?.width).toBe(1080);
    expect(info.tracks[0]?.height).toBe(1920);
  });

  it('distinguishes audio tracks from video tracks', () => {
    const info = inspectMp4(
      mp4File({
        tracks: [
          { handler: 'vide', width: 1080, height: 1920 },
          { handler: 'soun' },
        ],
      }),
    );
    expect(info.tracks.map((track) => track.handler)).toEqual(['vide', 'soun']);
  });

  it('reports no ftyp when the file does not start with one', () => {
    const info = inspectMp4(bytes(box('moov', mvhd(4))));
    expect(info.hasFtyp).toBe(false);
    expect(info.durationSec).toBeCloseTo(4, 3);
  });

  it('omits dimensions rather than inventing them when the header has none', () => {
    const info = inspectMp4(mp4File({ tracks: [{ handler: 'soun' }] }));
    expect(info.tracks[0]?.width).toBeUndefined();
  });

  it('returns a null duration when there is no movie header', () => {
    const info = inspectMp4(bytes(ftyp(), box('moov', trak({ handler: 'vide' }))));
    expect(info.durationSec).toBeNull();
  });

  it('ignores boxes it does not care about', () => {
    const withExtras = bytes(
      ftyp(),
      box('free', new Uint8Array(32)),
      box('mdat', new Uint8Array(64)),
      box('moov', mvhd(6), trak({ handler: 'vide', width: 720, height: 1280 })),
    );
    const info = inspectMp4(withExtras);
    expect(info.durationSec).toBeCloseTo(6, 3);
    expect(info.tracks[0]?.width).toBe(720);
  });

  it('rejects input too short to be a container', () => {
    expect(() => inspectMp4(new Uint8Array(4))).toThrow(Mp4ParseError);
  });

  it('rejects a box claiming an impossible size', () => {
    // Size 3 is smaller than the 8-byte header itself.
    expect(() => inspectMp4(bytes(uint32(3), new Uint8Array([0x66, 0x74, 0x79, 0x70])))).toThrow(
      Mp4ParseError,
    );
  });

  it('rejects a box that runs past the end of the file', () => {
    const truncated = bytes(uint32(9999), new Uint8Array([0x66, 0x74, 0x79, 0x70]), uint32(0));
    expect(() => inspectMp4(truncated)).toThrow(/past the end/);
  });

  it('treats a zero size as extending to the end of the file', () => {
    const toEnd = bytes(uint32(0), new Uint8Array([0x66, 0x74, 0x79, 0x70]), new Uint8Array(16));
    expect(inspectMp4(toEnd).hasFtyp).toBe(true);
  });
});
