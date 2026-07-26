import { describe, expect, it } from 'vitest';
import { aspectOf, fitTransform, sampleUv } from '../src/engine/render/stage';
import { CANVAS_EXPORT_DEFAULT } from '../src/engine/export/spec';

const FRAME_ASPECT = aspectOf(CANVAS_EXPORT_DEFAULT.width, CANVAS_EXPORT_DEFAULT.height);
const SQUARE = 1;

describe('fitTransform — contain', () => {
  it('fills the width and letterboxes square art in a 9:16 frame', () => {
    const fit = fitTransform(SQUARE, FRAME_ASPECT, 'contain');

    expect(fit.scale[0]).toBe(1);
    expect(fit.scale[1]).toBeCloseTo(9 / 16, 12);
    expect(fit.offset[0]).toBe(0);
    // Equal bars top and bottom.
    expect(fit.offset[1]).toBeCloseTo((1 - 9 / 16) / 2, 12);
  });

  it('shows the whole artwork and nothing outside it', () => {
    const fit = fitTransform(SQUARE, FRAME_ASPECT, 'contain');

    // The centre of the frame is the centre of the artwork.
    expect(sampleUv([0.5, 0.5], fit)).toEqual([expect.closeTo(0.5, 12), expect.closeTo(0.5, 12)]);

    // The top and bottom of the frame fall outside the artwork — the bars.
    expect(sampleUv([0.5, 0], fit)[1]).toBeLessThan(0);
    expect(sampleUv([0.5, 1], fit)[1]).toBeGreaterThan(1);

    // The artwork's own top edge sits exactly where the bar ends.
    expect(sampleUv([0.5, fit.offset[1]], fit)[1]).toBeCloseTo(0, 12);
  });

  it('letterboxes on the other axis when the source is narrower than the frame', () => {
    // A 1:4 tower is narrower (0.25) than 9:16 (0.5625): height-limited.
    const fit = fitTransform(0.25, FRAME_ASPECT, 'contain');

    expect(fit.scale[1]).toBe(1);
    expect(fit.scale[0]).toBeCloseTo(0.25 / FRAME_ASPECT, 12);
    expect(sampleUv([0, 0.5], fit)[0]).toBeLessThan(0);
  });
});

describe('fitTransform — cover', () => {
  it('crops square art horizontally to fill a 9:16 frame', () => {
    const fit = fitTransform(SQUARE, FRAME_ASPECT, 'cover');

    expect(fit.scale[1]).toBe(1);
    expect(fit.scale[0]).toBeCloseTo(1 / FRAME_ASPECT, 12);

    // Every visible frame position samples inside the texture: no gaps.
    for (const p of [0, 0.25, 0.5, 0.75, 1]) {
      const [u, v] = sampleUv([p, p], fit);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThanOrEqual(1);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }

    // The crop is centred and symmetric.
    const left = sampleUv([0, 0.5], fit)[0];
    const right = sampleUv([1, 0.5], fit)[0];
    expect(left).toBeCloseTo(1 - right, 12);
  });

  it('is the inverse of contain on the constrained axis', () => {
    const contain = fitTransform(SQUARE, FRAME_ASPECT, 'contain');
    const cover = fitTransform(SQUARE, FRAME_ASPECT, 'cover');
    expect(contain.scale[1] * cover.scale[0]).toBeCloseTo(1, 12);
  });
});

describe('fitTransform — shared behaviour', () => {
  it('is the identity when source and frame aspects match', () => {
    for (const mode of ['contain', 'cover'] as const) {
      const fit = fitTransform(FRAME_ASPECT, FRAME_ASPECT, mode);
      expect(fit.scale).toEqual([1, 1]);
      expect(fit.offset).toEqual([0, 0]);
    }
  });

  it('keeps the frame centre on the artwork centre in both modes', () => {
    for (const mode of ['contain', 'cover'] as const) {
      for (const srcAspect of [0.25, 0.5625, 1, 1.5, 4]) {
        const [u, v] = sampleUv([0.5, 0.5], fitTransform(srcAspect, FRAME_ASPECT, mode));
        expect(u).toBeCloseTo(0.5, 12);
        expect(v).toBeCloseTo(0.5, 12);
      }
    }
  });

  it('rejects degenerate aspects', () => {
    expect(() => fitTransform(0, FRAME_ASPECT, 'contain')).toThrow(RangeError);
    expect(() => fitTransform(1, 0, 'contain')).toThrow(RangeError);
    expect(() => fitTransform(Number.NaN, 1, 'cover')).toThrow(RangeError);
    expect(() => fitTransform(1, Number.POSITIVE_INFINITY, 'cover')).toThrow(RangeError);
  });
});

describe('aspectOf', () => {
  it('is width over height', () => {
    expect(aspectOf(1080, 1920)).toBeCloseTo(0.5625, 12);
    expect(aspectOf(3000, 3000)).toBe(1);
  });

  it('rejects non-positive dimensions', () => {
    expect(() => aspectOf(0, 100)).toThrow(RangeError);
    expect(() => aspectOf(100, -1)).toThrow(RangeError);
  });
});
