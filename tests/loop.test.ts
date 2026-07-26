import { describe, expect, it } from 'vitest';
import {
  PREFERRED_DURATION_SEC,
  clampSegment,
  defaultSegment,
  frameCountForLoop,
  frameTime,
  loopPhase,
  timelineFrameFor,
} from '../src/engine/loop';
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

describe('defaultSegment', () => {
  it('starts at the beginning with the preferred length', () => {
    expect(defaultSegment(180)).toEqual({ startSec: 0, durationSec: PREFERRED_DURATION_SEC });
  });

  it('never asks for more audio than the track has', () => {
    expect(defaultSegment(2).durationSec).toBe(2);
  });

  it('stays inside the platform maximum', () => {
    expect(defaultSegment(600).durationSec).toBeLessThanOrEqual(CANVAS_SPEC.maxDurationSec);
  });

  it('picks a length inside the accepted window for a normal track', () => {
    const { durationSec } = defaultSegment(240);
    expect(durationSec).toBeGreaterThanOrEqual(CANVAS_SPEC.minDurationSec);
    expect(durationSec).toBeLessThanOrEqual(CANVAS_SPEC.maxDurationSec);
  });
});

describe('clampSegment', () => {
  it('leaves a valid segment alone', () => {
    const segment = { startSec: 10, durationSec: 5 };
    expect(clampSegment(segment, 60)).toEqual(segment);
  });

  it('pulls a segment back inside the track', () => {
    expect(clampSegment({ startSec: 58, durationSec: 5 }, 60)).toEqual({
      startSec: 55,
      durationSec: 5,
    });
  });

  it('refuses a negative start', () => {
    expect(clampSegment({ startSec: -4, durationSec: 5 }, 60).startSec).toBe(0);
  });

  it('holds duration within the platform window', () => {
    expect(clampSegment({ startSec: 0, durationSec: 30 }, 60).durationSec).toBe(
      CANVAS_SPEC.maxDurationSec,
    );
    expect(clampSegment({ startSec: 0, durationSec: 0.5 }, 60).durationSec).toBe(
      CANVAS_SPEC.minDurationSec,
    );
  });

  it('returns the whole of a track too short to satisfy the minimum', () => {
    // Better to hand this to the validator than to invent audio that is absent.
    expect(clampSegment({ startSec: 0, durationSec: 5 }, 1.5)).toEqual({
      startSec: 0,
      durationSec: 1.5,
    });
  });
});

describe('timelineFrameFor', () => {
  it('maps loop phase onto a frame of the whole-track timeline', () => {
    const segment = { startSec: 10, durationSec: 4 };
    expect(timelineFrameFor(segment, 0, 30)).toBe(300);
    expect(timelineFrameFor(segment, 0.5, 30)).toBe(360);
    // Phase 1 lands where phase 0 of the next repeat would: the seam.
    expect(timelineFrameFor(segment, 1, 30)).toBe(420);
  });

  it('rejects a non-positive fps', () => {
    expect(() => timelineFrameFor({ startSec: 0, durationSec: 4 }, 0, 0)).toThrow(RangeError);
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
