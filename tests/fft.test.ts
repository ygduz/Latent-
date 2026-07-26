import { describe, expect, it } from 'vitest';
import {
  binCountFor,
  binFrequency,
  fftInPlace,
  hannWindow,
  isPowerOfTwo,
  magnitudesInto,
} from '../src/engine/analysis/fft';

const SIZE = 1024;
const SAMPLE_RATE = 48_000;

/** Magnitude spectrum of a real signal produced by a generator function. */
function spectrumOf(sample: (index: number) => number, size = SIZE): Float32Array {
  const re = new Float32Array(size);
  const im = new Float32Array(size);
  for (let i = 0; i < size; i += 1) {
    re[i] = sample(i);
  }
  fftInPlace(re, im);
  const magnitudes = new Float32Array(binCountFor(size));
  magnitudesInto(re, im, magnitudes);
  return magnitudes;
}

function peakBin(magnitudes: Float32Array): number {
  let best = 0;
  for (let bin = 1; bin < magnitudes.length; bin += 1) {
    if (magnitudes[bin]! > magnitudes[best]!) {
      best = bin;
    }
  }
  return best;
}

describe('isPowerOfTwo', () => {
  it('accepts powers of two and rejects everything else', () => {
    for (const n of [1, 2, 4, 1024, 2048]) {
      expect(isPowerOfTwo(n)).toBe(true);
    }
    for (const n of [0, -4, 3, 1000, 2049, 1.5, Number.NaN]) {
      expect(isPowerOfTwo(n)).toBe(false);
    }
  });
});

describe('fftInPlace', () => {
  it('puts a cosine at exactly its own bin, scaled to ~1.0 at full scale', () => {
    const bin = 32;
    const magnitudes = spectrumOf((i) => Math.cos((2 * Math.PI * bin * i) / SIZE));

    expect(peakBin(magnitudes)).toBe(bin);
    expect(magnitudes[bin]!).toBeCloseTo(1, 3);
    // Neighbouring bins hold almost nothing for an exact-bin tone.
    expect(magnitudes[bin - 2]!).toBeLessThan(0.01);
    expect(magnitudes[bin + 2]!).toBeLessThan(0.01);
  });

  it('is scale-independent: the same tone reads the same at another FFT size', () => {
    const small = spectrumOf((i) => Math.cos((2 * Math.PI * 8 * i) / 256), 256);
    const large = spectrumOf((i) => Math.cos((2 * Math.PI * 64 * i) / 2048), 2048);
    expect(small[8]!).toBeCloseTo(large[64]!, 3);
  });

  it('puts a constant signal entirely in bin 0', () => {
    const magnitudes = spectrumOf(() => 0.5);
    expect(magnitudes[0]!).toBeCloseTo(1, 3); // 0.5 * SIZE / (SIZE/2)
    for (let bin = 1; bin < magnitudes.length; bin += 1) {
      expect(magnitudes[bin]!).toBeLessThan(1e-3);
    }
  });

  it('resolves two tones independently', () => {
    const magnitudes = spectrumOf(
      (i) =>
        Math.cos((2 * Math.PI * 16 * i) / SIZE) * 0.5 +
        Math.cos((2 * Math.PI * 100 * i) / SIZE) * 0.25,
    );
    expect(magnitudes[16]!).toBeCloseTo(0.5, 2);
    expect(magnitudes[100]!).toBeCloseTo(0.25, 2);
    expect(magnitudes[60]!).toBeLessThan(0.01);
  });

  it('returns silence for silence', () => {
    const magnitudes = spectrumOf(() => 0);
    for (const value of magnitudes) {
      expect(value).toBe(0);
    }
  });

  it('rejects invalid lengths', () => {
    expect(() => fftInPlace(new Float32Array(6), new Float32Array(6))).toThrow(RangeError);
    expect(() => fftInPlace(new Float32Array(8), new Float32Array(4))).toThrow(RangeError);
  });
});

describe('magnitudesInto', () => {
  it('requires an output buffer of the right size', () => {
    const re = new Float32Array(8);
    const im = new Float32Array(8);
    expect(() => magnitudesInto(re, im, new Float32Array(4))).toThrow(RangeError);
    expect(() => magnitudesInto(re, im, new Float32Array(5))).not.toThrow();
  });
});

describe('bin helpers', () => {
  it('counts the non-redundant bins', () => {
    expect(binCountFor(2048)).toBe(1025);
    expect(binCountFor(8)).toBe(5);
  });

  it('maps bins to frequencies, ending at Nyquist', () => {
    expect(binFrequency(0, 2048, SAMPLE_RATE)).toBe(0);
    expect(binFrequency(1024, 2048, SAMPLE_RATE)).toBe(SAMPLE_RATE / 2);
    expect(binFrequency(16, 2048, SAMPLE_RATE)).toBeCloseTo(375, 6);
  });
});

describe('hannWindow', () => {
  it('starts at zero and peaks in the middle', () => {
    const window = hannWindow(64);
    expect(window).toHaveLength(64);
    expect(window[0]!).toBe(0);
    expect(window[32]!).toBeCloseTo(1, 6);
  });

  it('is symmetric about its peak', () => {
    const window = hannWindow(64);
    for (let i = 1; i < 32; i += 1) {
      expect(window[32 - i]!).toBeCloseTo(window[32 + i]!, 6);
    }
  });

  it('rejects invalid sizes', () => {
    expect(() => hannWindow(0)).toThrow(RangeError);
    expect(() => hannWindow(1.5)).toThrow(RangeError);
  });
});
