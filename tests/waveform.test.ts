import { describe, expect, it } from 'vitest';
import { WAVEFORM_BUCKETS, computePeaks } from '../src/engine/analysis/waveform';
import { makePcm, perChannel, silence, sine } from './fixtures/pcm';

const maxOf = (values: Float32Array) => values.reduce((best, value) => Math.max(best, value), 0);

describe('computePeaks', () => {
  it('returns one value per bucket, all within 0..1', () => {
    const peaks = computePeaks(makePcm(sine(220), { durationSec: 2 }), 64);
    expect(peaks).toHaveLength(64);
    for (const peak of peaks) {
      expect(peak).toBeGreaterThanOrEqual(0);
      expect(peak).toBeLessThanOrEqual(1);
    }
  });

  it('is flat for a steady tone', () => {
    const peaks = computePeaks(makePcm(sine(220), { durationSec: 2 }), 32);
    for (const peak of peaks) {
      expect(peak).toBeCloseTo(1, 2);
    }
  });

  it('follows the shape of the track', () => {
    // Loud for the first half, quiet for the second.
    const source = makePcm(
      (timeSec) => Math.sin(2 * Math.PI * 220 * timeSec) * (timeSec < 1 ? 1 : 0.1),
      { durationSec: 2 },
    );
    const peaks = computePeaks(source, 40);

    expect(peaks[5]!).toBeCloseTo(1, 1);
    expect(peaks[35]!).toBeCloseTo(0.1, 1);
    expect(peaks[5]!).toBeGreaterThan(peaks[35]! * 5);
  });

  it('normalizes against the track, so a quiet recording still reads', () => {
    const loud = computePeaks(makePcm(sine(220, 0.9), { durationSec: 1 }), 16);
    const quiet = computePeaks(makePcm(sine(220, 0.02), { durationSec: 1 }), 16);
    expect(maxOf(quiet)).toBeCloseTo(maxOf(loud), 2);
  });

  it('reads silence as silent rather than amplifying noise', () => {
    const peaks = computePeaks(makePcm(silence, { durationSec: 1 }), 16);
    expect(maxOf(peaks)).toBe(0);
  });

  it('takes the loudest channel at each point', () => {
    const source = makePcm(perChannel(() => 0.2, () => 0.9), {
      channels: 2,
      durationSec: 0.5,
    });
    // Normalized against 0.9, so the peak reads full rather than averaging to 0.55.
    expect(maxOf(computePeaks(source, 8))).toBeCloseTo(1, 3);
  });

  it('handles more buckets than the track has samples', () => {
    const source = makePcm(sine(220), { sampleRate: 8000, durationSec: 0.001 });
    const peaks = computePeaks(source, 64);
    expect(peaks).toHaveLength(64);
    for (const peak of peaks) {
      expect(Number.isFinite(peak)).toBe(true);
    }
  });

  it('returns zeros for an empty source', () => {
    const empty = { sampleRate: 48_000, length: 0, numberOfChannels: 1, getChannelData: () => new Float32Array(0) };
    expect(maxOf(computePeaks(empty, 8))).toBe(0);
  });

  it('rejects an invalid bucket count', () => {
    const source = makePcm(sine(220), { durationSec: 1 });
    expect(() => computePeaks(source, 0)).toThrow(RangeError);
    expect(() => computePeaks(source, -4)).toThrow(RangeError);
    expect(() => computePeaks(source, 2.5)).toThrow(RangeError);
  });

  it('uses a bucket count fine enough to show detail in a strip', () => {
    expect(WAVEFORM_BUCKETS).toBeGreaterThanOrEqual(200);
  });
});
