import { describe, expect, it } from 'vitest';
import { frameCountForLoop, frameTime, loopPhase } from '../src/engine/loop';
import { CANVAS_EXPORT_DEFAULT, CANVAS_SPEC } from '../src/engine/export/spec';

describe('loopPhase', () => {
  it('closes the seam: phase at the end of the loop equals phase at the start', () => {
    // This is the invariant the whole seamless-loop guarantee rests on.
    for (const duration of [3, 4.5, 5, 8]) {
      expect(loopPhase(duration, duration)).toBe(loopPhase(0, duration));
      expect(loopPhase(duration, duration)).toBe(0);
    }
  });

  it('runs 0..1 across the loop', () => {
    expect(loopPhase(0, 4)).toBe(0);
    expect(loopPhase(1, 4)).toBe(0.25);
    expect(loopPhase(2, 4)).toBe(0.5);
    expect(loopPhase(3, 4)).toBe(0.75);
  });

  it('wraps repeated loops back onto the same phase', () => {
    expect(loopPhase(5, 4)).toBeCloseTo(loopPhase(1, 4), 12);
    expect(loopPhase(9, 4)).toBeCloseTo(loopPhase(1, 4), 12);
  });

  it('wraps negative times forward instead of returning a negative phase', () => {
    expect(loopPhase(-1, 4)).toBeCloseTo(0.75, 12);
  });

  it('rejects a non-positive duration', () => {
    expect(() => loopPhase(1, 0)).toThrow(RangeError);
    expect(() => loopPhase(1, -4)).toThrow(RangeError);
  });
});

describe('frameCountForLoop', () => {
  it('excludes the duplicate final frame', () => {
    // 5s @ 30fps renders frames 0..149. Frame 150 would repeat frame 0 and
    // show as a one-frame stutter on every loop.
    expect(frameCountForLoop(5, 30)).toBe(150);
    expect(frameTime(frameCountForLoop(5, 30), 30)).toBe(5);
  });

  it('covers the Canvas duration range at the default fps', () => {
    const { fps } = CANVAS_EXPORT_DEFAULT;
    expect(frameCountForLoop(CANVAS_SPEC.minDurationSec, fps)).toBe(90);
    expect(frameCountForLoop(CANVAS_SPEC.maxDurationSec, fps)).toBe(240);
  });

  it('rejects invalid inputs', () => {
    expect(() => frameCountForLoop(0, 30)).toThrow(RangeError);
    expect(() => frameCountForLoop(5, 0)).toThrow(RangeError);
  });
});

describe('CANVAS_EXPORT_DEFAULT', () => {
  it('satisfies the Spotify Canvas spec it is derived from', () => {
    const { width, height } = CANVAS_EXPORT_DEFAULT;
    expect(width / height).toBeCloseTo(CANVAS_SPEC.aspectWidth / CANVAS_SPEC.aspectHeight, 12);
    expect(width).toBeLessThanOrEqual(CANVAS_SPEC.maxWidthPx);
    expect(width).toBeGreaterThanOrEqual(CANVAS_SPEC.minWidthPx);
  });
});
