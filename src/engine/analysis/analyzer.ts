import type { FeatureName, FeatureTimeline, SafetyLimits } from '../types';
import { FEATURE_NAMES } from '../types';
import {
  binCountFor,
  fftInPlace,
  hannWindow,
  isPowerOfTwo,
  magnitudesInto,
} from './fft';
import {
  BAND_EDGES_HZ,
  bandEnergy,
  clampInPlace,
  deriveSafetyLimits,
  normalizeByPercentileInPlace,
  rmsOf,
  slewLimitInPlace,
  smoothInPlace,
  smoothingAlpha,
  spectralCentroid,
  spectralFlux,
} from './features';

/**
 * Offline audio analysis: PCM in, per-frame feature timeline out.
 *
 * Analysis is offline and frame-aligned rather than realtime, for three
 * reasons: the result is deterministic (identical input always yields an
 * identical timeline, which is the product's core promise), normalization can
 * reference the whole track instead of guessing at levels as they arrive, and
 * export never has to depend on playback happening in real time.
 */

/**
 * The subset of `AudioBuffer` this needs. Declared structurally so tests can
 * pass synthetic PCM with no Web Audio involved — a real `AudioBuffer`
 * satisfies it as-is.
 */
export interface PcmSource {
  readonly sampleRate: number;
  readonly length: number;
  readonly numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
}

export interface AnalyzeOptions {
  /** Frames per second of the resulting timeline. Must match the render fps. */
  readonly fps: number;
  /** FFT size, a power of two. 2048 gives ~23 Hz resolution at 48 kHz. */
  readonly fftSize?: number;
  /** Overridden only by tests; production always derives these from fps. */
  readonly safety?: SafetyLimits;
}

export const DEFAULT_FFT_SIZE = 2048;

/** Average all channels into one. Motion responds to the mix, not to a side. */
export function mixToMono(source: PcmSource): Float32Array {
  const channelCount = Math.max(1, source.numberOfChannels);
  const mono = new Float32Array(source.length);

  for (let channel = 0; channel < channelCount; channel += 1) {
    const data = source.getChannelData(channel);
    const shared = Math.min(mono.length, data.length);
    for (let i = 0; i < shared; i += 1) {
      mono[i] = mono[i]! + data[i]!;
    }
  }

  if (channelCount > 1) {
    for (let i = 0; i < mono.length; i += 1) {
      mono[i] = mono[i]! / channelCount;
    }
  }

  return mono;
}

/**
 * Number of frames covering a source at a given frame rate.
 *
 * Frame offsets are computed from the frame index rather than accumulated, so
 * a non-integer samples-per-frame ratio cannot drift over a long track.
 */
export function frameCountFor(source: PcmSource, fps: number): number {
  return Math.max(1, Math.floor((source.length * fps) / source.sampleRate));
}

export function analyze(source: PcmSource, options: AnalyzeOptions): FeatureTimeline {
  const { fps, fftSize = DEFAULT_FFT_SIZE } = options;

  if (!(fps > 0)) {
    throw new RangeError(`fps must be > 0, got ${fps}`);
  }
  if (!isPowerOfTwo(fftSize)) {
    throw new RangeError(`fftSize must be a power of two, got ${fftSize}`);
  }
  if (!(source.sampleRate > 0)) {
    throw new RangeError(`sampleRate must be > 0, got ${source.sampleRate}`);
  }

  const safety = options.safety ?? deriveSafetyLimits(fps);
  const mono = mixToMono(source);
  const frameCount = frameCountFor(source, fps);

  const channels = Object.fromEntries(
    FEATURE_NAMES.map((name) => [name, new Float32Array(frameCount)]),
  ) as Record<FeatureName, Float32Array>;

  const window = hannWindow(fftSize);
  const re = new Float32Array(fftSize);
  const im = new Float32Array(fftSize);
  const block = new Float32Array(fftSize);
  const magnitudes = new Float32Array(binCountFor(fftSize));
  const previousMagnitudes = new Float32Array(binCountFor(fftSize));

  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = Math.round((frame * source.sampleRate) / fps);

    // Copy the analysis block, zero-padding past the end of the track.
    block.fill(0);
    const available = Math.max(0, Math.min(fftSize, mono.length - start));
    for (let i = 0; i < available; i += 1) {
      block[i] = mono[start + i]!;
    }

    // RMS comes from the unwindowed block so it reflects actual level.
    channels.rms[frame] = rmsOf(block);

    for (let i = 0; i < fftSize; i += 1) {
      re[i] = block[i]! * window[i]!;
      im[i] = 0;
    }
    fftInPlace(re, im);
    magnitudesInto(re, im, magnitudes);

    channels.lowBand[frame] = bandEnergy(
      magnitudes,
      fftSize,
      source.sampleRate,
      BAND_EDGES_HZ.low[0],
      BAND_EDGES_HZ.low[1],
    );
    channels.midBand[frame] = bandEnergy(
      magnitudes,
      fftSize,
      source.sampleRate,
      BAND_EDGES_HZ.mid[0],
      BAND_EDGES_HZ.mid[1],
    );
    channels.highBand[frame] = bandEnergy(
      magnitudes,
      fftSize,
      source.sampleRate,
      BAND_EDGES_HZ.high[0],
      BAND_EDGES_HZ.high[1],
    );
    channels.centroid[frame] = spectralCentroid(magnitudes, fftSize, source.sampleRate);
    channels.flux[frame] = frame === 0 ? 0 : spectralFlux(magnitudes, previousMagnitudes);

    // Keep this spectrum so the next frame can diff against it.
    previousMagnitudes.set(magnitudes);
  }

  const alpha = smoothingAlpha(fps);
  for (const name of FEATURE_NAMES) {
    const values = channels[name];
    // Centroid is already an absolute 0..1 position in the spectrum; rescaling
    // it against a percentile would pin a track of constant brightness to 1
    // and destroy its meaning. Energy-like channels do need rescaling.
    if (name !== 'centroid') {
      normalizeByPercentileInPlace(values);
    }
    smoothInPlace(values, alpha);
    slewLimitInPlace(values, safety.maxDeltaPerFrame);
    clampInPlace(values, safety.maxAmplitude);
  }

  return { fps, frameCount, channels };
}
