import { describe, expect, it } from 'vitest';
import { analyze, frameCountFor, mixToMono } from '../src/engine/analysis/analyzer';
import { deriveSafetyLimits } from '../src/engine/analysis/features';
import { FEATURE_NAMES } from '../src/engine/types';
import type { FeatureName, FeatureTimeline } from '../src/engine/types';
import { burstTrain, gate, makePcm, perChannel, silence, sine, sum } from './fixtures/pcm';

const FPS = 30;

const mean = (values: Float32Array) =>
  values.reduce((total, value) => total + value, 0) / Math.max(1, values.length);

const maxOf = (values: Float32Array) => values.reduce((best, value) => Math.max(best, value), 0);

const biggestStep = (values: Float32Array) => {
  let worst = 0;
  for (let i = 1; i < values.length; i += 1) {
    worst = Math.max(worst, Math.abs(values[i]! - values[i - 1]!));
  }
  return worst;
};

describe('mixToMono', () => {
  it('averages channels', () => {
    const source = makePcm(perChannel(() => 1, () => 0), { channels: 2, durationSec: 0.01 });
    expect(mixToMono(source)[0]!).toBeCloseTo(0.5, 6);
  });

  it('cancels out-of-phase channels, as an average must', () => {
    const source = makePcm(perChannel(() => 1, () => -1), { channels: 2, durationSec: 0.01 });
    expect(mixToMono(source)[0]!).toBeCloseTo(0, 6);
  });

  it('passes a mono source through unchanged', () => {
    const source = makePcm(() => 0.25, { channels: 1, durationSec: 0.01 });
    expect(mixToMono(source)[0]!).toBeCloseTo(0.25, 6);
  });
});

describe('frameCountFor', () => {
  it('covers the track at the requested frame rate', () => {
    expect(frameCountFor(makePcm(silence, { durationSec: 5 }), 30)).toBe(150);
    expect(frameCountFor(makePcm(silence, { durationSec: 2 }), 24)).toBe(48);
  });

  it('never returns zero frames, however short the source', () => {
    expect(frameCountFor(makePcm(silence, { durationSec: 0.001 }), 30)).toBe(1);
  });
});

describe('analyze — content', () => {
  it('produces a timeline shaped to the track', () => {
    const timeline = analyze(makePcm(sine(440), { durationSec: 4 }), { fps: FPS });

    expect(timeline.fps).toBe(FPS);
    expect(timeline.frameCount).toBe(120);
    for (const name of FEATURE_NAMES) {
      expect(timeline.channels[name]).toHaveLength(120);
    }
  });

  it('reports nothing at all for silence', () => {
    const timeline = analyze(makePcm(silence, { durationSec: 2 }), { fps: FPS });

    for (const name of FEATURE_NAMES) {
      expect(maxOf(timeline.channels[name])).toBe(0);
    }
  });

  it('puts a bass tone in the low band and leaves the high band alone', () => {
    const timeline = analyze(makePcm(sine(60), { durationSec: 3 }), { fps: FPS });

    expect(mean(timeline.channels.lowBand)).toBeGreaterThan(0.5);
    // Not merely smaller — the high band holds only leakage, so it must stay at
    // zero rather than being normalized up into visible motion.
    expect(maxOf(timeline.channels.highBand)).toBe(0);
  });

  it('puts a bright tone in the high band and leaves the low band alone', () => {
    const timeline = analyze(makePcm(sine(8000), { durationSec: 3 }), { fps: FPS });

    expect(mean(timeline.channels.highBand)).toBeGreaterThan(0.5);
    expect(maxOf(timeline.channels.lowBand)).toBe(0);
  });

  it('separates simultaneous content into its bands', () => {
    const timeline = analyze(makePcm(sum(sine(60, 0.5), sine(8000, 0.5)), { durationSec: 3 }), {
      fps: FPS,
    });

    expect(mean(timeline.channels.lowBand)).toBeGreaterThan(0.5);
    expect(mean(timeline.channels.highBand)).toBeGreaterThan(0.5);
    expect(maxOf(timeline.channels.midBand)).toBe(0);
  });

  it('gives a quiet track as much motion as a loud one', () => {
    const loud = analyze(makePcm(sine(220, 0.9), { durationSec: 3 }), { fps: FPS });
    const quiet = analyze(makePcm(sine(220, 0.02), { durationSec: 3 }), { fps: FPS });

    // Normalization is per track, so ambient material is not penalised for
    // being quiet — this is the point of analysing offline.
    expect(mean(quiet.channels.rms)).toBeCloseTo(mean(loud.channels.rms), 2);
  });

  it('tracks brightness in the centroid without rescaling it', () => {
    const dark = analyze(makePcm(sine(80), { durationSec: 2 }), { fps: FPS });
    const bright = analyze(makePcm(sine(9000), { durationSec: 2 }), { fps: FPS });

    expect(mean(bright.channels.centroid)).toBeGreaterThan(mean(dark.channels.centroid));
  });
});

describe('analyze — determinism', () => {
  it('returns identical timelines for identical input', () => {
    const pcm = makePcm(sum(sine(110), sine(1320, 0.4)), { durationSec: 2 });
    const first = analyze(pcm, { fps: FPS });
    const second = analyze(pcm, { fps: FPS });

    for (const name of FEATURE_NAMES) {
      expect(Array.from(second.channels[name])).toEqual(Array.from(first.channels[name]));
    }
  });

  it('does not drift when samples per frame is not a whole number', () => {
    // 44100 / 30 = 1470 exactly, but 44100 / 24 = 1837.5 is not. Offsets are
    // computed from the frame index, so the last frame must still line up.
    const timeline = analyze(makePcm(sine(440), { sampleRate: 44_100, durationSec: 10 }), {
      fps: 24,
    });
    expect(timeline.frameCount).toBe(240);
    expect(maxOf(timeline.channels.rms)).toBeGreaterThan(0);
  });
});

describe('analyze — safety guarantees', () => {
  /** The most strobe-provoking inputs available. */
  const hostileSources = {
    'bursts at 15 per second': burstTrain(15),
    'bursts at 30 per second': burstTrain(30),
    'a single full-scale transient': (timeSec: number) => (timeSec > 0.99 && timeSec < 1.01 ? 1 : 0),
  } as const;

  const limits = deriveSafetyLimits(FPS);

  for (const [description, sample] of Object.entries(hostileSources)) {
    it(`bounds every feature's rate of change given ${description}`, () => {
      const timeline = analyze(makePcm(sample, { durationSec: 4 }), { fps: FPS });

      for (const name of FEATURE_NAMES) {
        expect(
          biggestStep(timeline.channels[name]),
          `${name} changed faster than the slew limit`,
        ).toBeLessThanOrEqual(limits.maxDeltaPerFrame + 1e-6);
      }
    });

    it(`keeps every feature within 0..maxAmplitude given ${description}`, () => {
      const timeline = analyze(makePcm(sample, { durationSec: 4 }), { fps: FPS });

      for (const name of FEATURE_NAMES) {
        for (const value of timeline.channels[name]) {
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(limits.maxAmplitude);
        }
      }
    });
  }

  it('cannot be made to strobe by overriding the safety limits with looser ones', () => {
    // The pipeline always applies whatever limits it is given, so a caller
    // cannot bypass the stage — only choose a bound.
    const pcm = makePcm(burstTrain(15), { durationSec: 3 });
    const strict = analyze(pcm, { fps: FPS, safety: { maxDeltaPerFrame: 0.01, maxAmplitude: 0.5 } });

    for (const name of FEATURE_NAMES) {
      expect(biggestStep(strict.channels[name])).toBeLessThanOrEqual(0.01 + 1e-6);
      expect(maxOf(strict.channels[name])).toBeLessThanOrEqual(0.5);
    }
  });

  it('still responds to the music it is limiting', () => {
    // A guarantee that flattened everything to zero would pass the bounds above
    // while making the product useless.
    const timeline = analyze(makePcm(burstTrain(2), { durationSec: 4 }), { fps: FPS });
    expect(maxOf(timeline.channels.rms)).toBeGreaterThan(0.3);
    expect(biggestStep(timeline.channels.rms)).toBeGreaterThan(0);
  });
});

describe('analyze — validation', () => {
  const pcm = makePcm(sine(440), { durationSec: 1 });

  it('rejects a non-positive fps', () => {
    expect(() => analyze(pcm, { fps: 0 })).toThrow(RangeError);
    expect(() => analyze(pcm, { fps: -30 })).toThrow(RangeError);
  });

  it('rejects an FFT size that is not a power of two', () => {
    expect(() => analyze(pcm, { fps: FPS, fftSize: 1000 })).toThrow(RangeError);
  });

  it('accepts other valid FFT sizes', () => {
    expect(() => analyze(pcm, { fps: FPS, fftSize: 1024 })).not.toThrow();
    expect(() => analyze(pcm, { fps: FPS, fftSize: 4096 })).not.toThrow();
  });

  it('rejects a source with no sample rate', () => {
    const broken: FeatureTimeline extends never ? never : Parameters<typeof analyze>[0] = {
      sampleRate: 0,
      length: 100,
      numberOfChannels: 1,
      getChannelData: () => new Float32Array(100),
    };
    expect(() => analyze(broken, { fps: FPS })).toThrow(RangeError);
  });
});

describe('analyze — channel coverage', () => {
  it('fills every declared feature channel', () => {
    // Gated rather than steady: flux measures onsets, and a continuous tone has
    // none, so a sustained signal legitimately leaves that channel at zero.
    const source = makePcm(gate(sum(sine(60), sine(900), sine(9000)), 4), { durationSec: 4 });
    const timeline = analyze(source, { fps: FPS });

    const active = FEATURE_NAMES.filter((name: FeatureName) => maxOf(timeline.channels[name]) > 0);
    expect(active).toEqual([...FEATURE_NAMES]);
  });

  it('leaves flux at zero for a sustained tone, which has no onsets', () => {
    const timeline = analyze(makePcm(sine(440), { durationSec: 3 }), { fps: FPS });
    expect(maxOf(timeline.channels.flux)).toBe(0);
    expect(maxOf(timeline.channels.rms)).toBeGreaterThan(0);
  });
});
