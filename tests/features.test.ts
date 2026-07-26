import { describe, expect, it } from 'vitest';
import {
  BAND_EDGES_HZ,
  MAX_FEATURE_AMPLITUDE,
  MIN_FULL_SWING_SECONDS,
  SIGNAL_FLOOR,
  bandEnergy,
  clampInPlace,
  deriveSafetyLimits,
  float32Ceiling,
  normalizeByPercentileInPlace,
  percentileOf,
  rmsOf,
  sampleFeatures,
  slewLimitInPlace,
  smoothInPlace,
  smoothingAlpha,
  spectralCentroid,
  spectralFlux,
} from '../src/engine/analysis/features';
import { binCountFor } from '../src/engine/analysis/fft';
import type { FeatureName, FeatureTimeline } from '../src/engine/types';
import { FEATURE_NAMES } from '../src/engine/types';

const FFT_SIZE = 2048;
const SAMPLE_RATE = 48_000;

/** A magnitude spectrum with energy only at one frequency. */
function spectrumAt(frequencyHz: number, magnitude = 1): Float32Array {
  const magnitudes = new Float32Array(binCountFor(FFT_SIZE));
  const bin = Math.round((frequencyHz * FFT_SIZE) / SAMPLE_RATE);
  magnitudes[bin] = magnitude;
  return magnitudes;
}

const energyIn = (band: keyof typeof BAND_EDGES_HZ, spectrum: Float32Array) =>
  bandEnergy(spectrum, FFT_SIZE, SAMPLE_RATE, BAND_EDGES_HZ[band][0], BAND_EDGES_HZ[band][1]);

describe('rmsOf', () => {
  it('is the amplitude for a constant signal', () => {
    expect(rmsOf(new Float32Array([1, 1, 1, 1]))).toBeCloseTo(1, 6);
    expect(rmsOf(new Float32Array([0.5, 0.5]))).toBeCloseTo(0.5, 6);
  });

  it('is ~0.707 of peak for a sine', () => {
    const samples = new Float32Array(4800);
    for (let i = 0; i < samples.length; i += 1) {
      samples[i] = Math.sin((2 * Math.PI * 100 * i) / SAMPLE_RATE);
    }
    expect(rmsOf(samples)).toBeCloseTo(Math.SQRT1_2, 2);
  });

  it('is zero for silence and for nothing', () => {
    expect(rmsOf(new Float32Array(64))).toBe(0);
    expect(rmsOf(new Float32Array(0))).toBe(0);
  });
});

describe('bandEnergy', () => {
  it('places content in the band it belongs to and nowhere else', () => {
    const low = spectrumAt(60);
    expect(energyIn('low', low)).toBeGreaterThan(0);
    expect(energyIn('mid', low)).toBe(0);
    expect(energyIn('high', low)).toBe(0);

    const mid = spectrumAt(900);
    expect(energyIn('mid', mid)).toBeGreaterThan(0);
    expect(energyIn('low', mid)).toBe(0);
    expect(energyIn('high', mid)).toBe(0);

    const high = spectrumAt(8000);
    expect(energyIn('high', high)).toBeGreaterThan(0);
    expect(energyIn('low', high)).toBe(0);
    expect(energyIn('mid', high)).toBe(0);
  });

  it('averages rather than sums, so a wide band is not inherently louder', () => {
    // Equal magnitude in each band: the narrow low band must not read higher
    // than the wide high band purely because of bin count.
    const spread = new Float32Array(binCountFor(FFT_SIZE));
    spread.fill(0.25, 1);
    expect(energyIn('low', spread)).toBeCloseTo(energyIn('high', spread), 6);
  });

  it('returns zero for an empty or inverted range', () => {
    expect(bandEnergy(spectrumAt(60), FFT_SIZE, SAMPLE_RATE, 5000, 1000)).toBe(0);
  });

  it('never reads past Nyquist', () => {
    const spectrum = spectrumAt(20_000, 1);
    expect(() =>
      bandEnergy(spectrum, FFT_SIZE, SAMPLE_RATE, 2000, 96_000),
    ).not.toThrow();
  });
});

describe('spectralCentroid', () => {
  it('rises with the brightness of the content', () => {
    const low = spectralCentroid(spectrumAt(80), FFT_SIZE, SAMPLE_RATE);
    const mid = spectralCentroid(spectrumAt(1000), FFT_SIZE, SAMPLE_RATE);
    const high = spectralCentroid(spectrumAt(12_000), FFT_SIZE, SAMPLE_RATE);

    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(high);
  });

  it('stays within 0..1', () => {
    for (const frequency of [30, 200, 2000, 20_000, 23_900]) {
      const value = spectralCentroid(spectrumAt(frequency), FFT_SIZE, SAMPLE_RATE);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('is zero when there is no content', () => {
    const empty = new Float32Array(binCountFor(FFT_SIZE));
    expect(spectralCentroid(empty, FFT_SIZE, SAMPLE_RATE)).toBe(0);
  });

  it('is log-scaled, not linear', () => {
    // Two octaves up from 100 Hz should move the centroid about as far as two
    // octaves up from 400 Hz. A linear mapping would not behave this way.
    const at = (hz: number) => spectralCentroid(spectrumAt(hz), FFT_SIZE, SAMPLE_RATE);
    const firstJump = at(400) - at(100);
    const secondJump = at(1600) - at(400);
    expect(Math.abs(firstJump - secondJump)).toBeLessThan(0.05);
  });
});

describe('spectralFlux', () => {
  it('reports growth and ignores decay', () => {
    const quiet = spectrumAt(1000, 0.2);
    const loud = spectrumAt(1000, 0.8);

    expect(spectralFlux(loud, quiet)).toBeGreaterThan(0);
    expect(spectralFlux(quiet, loud)).toBe(0);
  });

  it('is zero for an unchanging spectrum', () => {
    const spectrum = spectrumAt(1000);
    expect(spectralFlux(spectrum, spectrum)).toBe(0);
  });

  it('requires matching spectra', () => {
    expect(() => spectralFlux(new Float32Array(4), new Float32Array(8))).toThrow(RangeError);
  });
});

describe('percentileOf', () => {
  it('picks the value at the requested rank', () => {
    const values = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(percentileOf(values, 0)).toBe(0);
    expect(percentileOf(values, 1)).toBe(9);
    // Nearest-rank, not interpolated: index round(0.5 * 9) = 5.
    expect(percentileOf(values, 0.5)).toBe(5);
  });

  it('does not depend on input order and does not modify the input', () => {
    const values = new Float32Array([5, 1, 9, 3]);
    const copy = Float32Array.from(values);
    expect(percentileOf(values, 1)).toBe(9);
    expect(Array.from(values)).toEqual(Array.from(copy));
  });

  it('rejects percentiles outside 0..1', () => {
    expect(() => percentileOf(new Float32Array([1]), 1.5)).toThrow(RangeError);
    expect(() => percentileOf(new Float32Array([1]), -0.1)).toThrow(RangeError);
  });
});

describe('normalizeByPercentileInPlace', () => {
  it('scales the reference percentile to 1 and clamps above it', () => {
    const values = new Float32Array([0, 0.1, 0.2, 0.4, 4]);
    normalizeByPercentileInPlace(values, 0.75); // reference = 0.4
    expect(values[3]!).toBeCloseTo(1, 6);
    expect(values[2]!).toBeCloseTo(0.5, 6);
    expect(values[4]!).toBe(1); // the outlier is clamped, not allowed to dominate
  });

  it('gives a quiet track the same range as a loud one', () => {
    const loud = new Float32Array([0, 0.5, 1]);
    const quiet = new Float32Array([0, 0.005, 0.01]);
    normalizeByPercentileInPlace(loud, 1);
    normalizeByPercentileInPlace(quiet, 1);
    expect(Array.from(quiet)).toEqual(Array.from(loud));
  });

  it('leaves a channel with no real content at zero instead of amplifying noise', () => {
    // A bass-only track's high band holds only spectral leakage. Scaling that
    // to full range would manufacture motion out of nothing.
    const leakage = new Float32Array([0, SIGNAL_FLOOR / 100, SIGNAL_FLOOR / 50]);
    normalizeByPercentileInPlace(leakage);
    expect(Array.from(leakage)).toEqual([0, 0, 0]);
  });

  it('zeroes exact silence', () => {
    const values = new Float32Array(8);
    normalizeByPercentileInPlace(values);
    expect(Array.from(values)).toEqual(Array.from(new Float32Array(8)));
  });
});

describe('smoothInPlace', () => {
  it('leaves the signal untouched at alpha 1', () => {
    const values = new Float32Array([0, 1, 0, 1]);
    smoothInPlace(values, 1);
    expect(Array.from(values)).toEqual([0, 1, 0, 1]);
  });

  it('approaches a step without overshooting it', () => {
    const values = new Float32Array(64).fill(1);
    values[0] = 0;
    smoothInPlace(values, 0.2);

    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]!).toBeGreaterThanOrEqual(values[i - 1]!);
      expect(values[i]!).toBeLessThanOrEqual(1);
    }
    expect(values.at(-1)!).toBeCloseTo(1, 3);
  });

  it('reduces the size of frame-to-frame jumps', () => {
    const jagged = new Float32Array(32);
    for (let i = 0; i < jagged.length; i += 1) {
      jagged[i] = i % 2;
    }
    const smoothed = Float32Array.from(jagged);
    smoothInPlace(smoothed, 0.25);

    const biggestJump = (values: Float32Array) => {
      let worst = 0;
      for (let i = 1; i < values.length; i += 1) {
        worst = Math.max(worst, Math.abs(values[i]! - values[i - 1]!));
      }
      return worst;
    };
    expect(biggestJump(smoothed)).toBeLessThan(biggestJump(jagged));
  });

  it('rejects an out-of-range alpha', () => {
    expect(() => smoothInPlace(new Float32Array(4), 0)).toThrow(RangeError);
    expect(() => smoothInPlace(new Float32Array(4), 1.2)).toThrow(RangeError);
  });
});

describe('slewLimitInPlace', () => {
  it('turns an instant jump into a bounded ramp', () => {
    const values = new Float32Array(32).fill(1);
    values[0] = 0;
    slewLimitInPlace(values, 0.1);

    expect(values[1]!).toBeCloseTo(0.1, 6);
    expect(values[5]!).toBeCloseTo(0.5, 6);
    expect(values[10]!).toBeCloseTo(1, 6);
  });

  it('bounds every step, however hostile the input', () => {
    const alternating = new Float32Array(256);
    for (let i = 0; i < alternating.length; i += 1) {
      alternating[i] = i % 2 === 0 ? 0 : 1;
    }
    const limit = 0.05;
    slewLimitInPlace(alternating, limit);

    for (let i = 1; i < alternating.length; i += 1) {
      expect(Math.abs(alternating[i]! - alternating[i - 1]!)).toBeLessThanOrEqual(limit + 1e-6);
    }
  });

  it('passes through changes already within the limit', () => {
    const gentle = new Float32Array([0, 0.01, 0.02, 0.03]);
    slewLimitInPlace(gentle, 0.5);
    // Compared with tolerance because Float32 storage cannot hold these exactly.
    expect(Array.from(gentle)).toEqual([
      expect.closeTo(0, 6),
      expect.closeTo(0.01, 6),
      expect.closeTo(0.02, 6),
      expect.closeTo(0.03, 6),
    ]);
  });

  it('rejects a non-positive limit', () => {
    expect(() => slewLimitInPlace(new Float32Array(4), 0)).toThrow(RangeError);
  });
});

describe('clampInPlace', () => {
  it('holds values inside 0..max', () => {
    const values = new Float32Array([-1, 0.5, 2]);
    clampInPlace(values, 0.85);
    expect(values[0]!).toBe(0);
    expect(values[1]!).toBeCloseTo(0.5, 6);
    expect(values[2]!).toBeCloseTo(0.85, 6);
  });

  it('produces stored values that genuinely satisfy the bound', () => {
    // Float32 rounding can land just above a float64 limit, which would break
    // any downstream check asserting the ceiling holds.
    for (const max of [0.85, 0.1, 0.333, 0.9999]) {
      const values = new Float32Array([2, 1, max * 2]);
      clampInPlace(values, max);
      for (const value of values) {
        expect(value).toBeLessThanOrEqual(max);
      }
    }
  });

  it('stays as close to the requested ceiling as Float32 allows', () => {
    const values = new Float32Array([5]);
    clampInPlace(values, 0.85);
    expect(0.85 - values[0]!).toBeLessThan(1e-6);
  });
});

describe('float32Ceiling', () => {
  it('never exceeds the requested value', () => {
    for (const max of [0.85, 0.1, 0.2, 0.333, 0.7, 0.9999, 1]) {
      expect(float32Ceiling(max)).toBeLessThanOrEqual(max);
    }
  });

  it('is exactly representable, so storing it does not round upward', () => {
    for (const max of [0.85, 0.333, 0.9999]) {
      const ceiling = float32Ceiling(max);
      const stored = new Float32Array([ceiling]);
      expect(stored[0]!).toBe(ceiling);
      expect(stored[0]!).toBeLessThanOrEqual(max);
    }
  });

  it('leaves already-representable values alone', () => {
    for (const max of [0.5, 0.875, 0.25, 1]) {
      expect(float32Ceiling(max)).toBe(max);
    }
  });
});

describe('deriveSafetyLimits', () => {
  it('needs at least the minimum swing time to cross the full range', () => {
    for (const fps of [24, 30, 60]) {
      const { maxDeltaPerFrame, maxAmplitude } = deriveSafetyLimits(fps);
      const framesForFullSwing = maxAmplitude / maxDeltaPerFrame;
      expect(framesForFullSwing / fps).toBeCloseTo(MIN_FULL_SWING_SECONDS, 6);
    }
  });

  it('stays well inside the WCAG 2.3.1 limit of three flashes per second', () => {
    const fps = 30;
    const { maxDeltaPerFrame, maxAmplitude } = deriveSafetyLimits(fps);
    // A flash is a rise and a fall, so a full cycle is two swings.
    const flashesPerSecond = 1 / ((2 * (maxAmplitude / maxDeltaPerFrame)) / fps);
    expect(flashesPerSecond).toBeLessThan(3);
    expect(flashesPerSecond).toBeCloseTo(1, 6);
  });

  it('caps amplitude below full range to leave headroom', () => {
    expect(deriveSafetyLimits(30).maxAmplitude).toBe(MAX_FEATURE_AMPLITUDE);
    expect(MAX_FEATURE_AMPLITUDE).toBeLessThan(1);
  });

  it('rejects a non-positive fps', () => {
    expect(() => deriveSafetyLimits(0)).toThrow(RangeError);
  });
});

describe('smoothingAlpha', () => {
  it('smooths more at higher frame rates for the same time constant', () => {
    expect(smoothingAlpha(60)).toBeLessThan(smoothingAlpha(30));
  });

  it('stays within 0..1', () => {
    for (const fps of [1, 24, 30, 60, 240]) {
      const alpha = smoothingAlpha(fps);
      expect(alpha).toBeGreaterThan(0);
      expect(alpha).toBeLessThanOrEqual(1);
    }
  });
});

describe('sampleFeatures', () => {
  const timeline: FeatureTimeline = {
    fps: 30,
    frameCount: 3,
    channels: Object.fromEntries(
      FEATURE_NAMES.map((name, index) => [name, new Float32Array([index / 10, 0.5, 0.9])]),
    ) as Record<FeatureName, Float32Array>,
  };

  it('reads every feature at a frame', () => {
    const sample = sampleFeatures(timeline, 1);
    expect(Object.keys(sample).sort()).toEqual([...FEATURE_NAMES].sort());
    expect(sample.rms).toBeCloseTo(0.5, 6);
  });

  it('clamps out-of-range frames rather than returning undefined', () => {
    expect(sampleFeatures(timeline, -5).rms).toBeCloseTo(0, 6);
    expect(sampleFeatures(timeline, 99).rms).toBeCloseTo(0.9, 6);
  });
});
