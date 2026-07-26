import type { FeatureName, FeatureSample, FeatureTimeline, SafetyLimits } from '../types';
import { FEATURE_NAMES } from '../types';
import { binCountFor, binFrequency } from './fft';

/**
 * Feature extraction and the safety pipeline.
 *
 * Raw features are extracted per frame, then every channel goes through the
 * same fixed sequence:
 *
 *   1. normalize   scale to 0..1 against a high percentile of the whole track
 *   2. smooth      one-pole lowpass, removes frame-to-frame jitter
 *   3. slew limit  hard cap on change per frame — the no-strobe guarantee
 *   4. clamp       ceiling, leaving headroom so peaks never slam a parameter
 *
 * Steps 3 and 4 are not stylistic. They run before any effect sees a value, so
 * no preset, slider or routing combination can produce a strobing render.
 */

// --- Constants -------------------------------------------------------------

/** Band crossovers, chosen to be musically legible rather than perceptually exact. */
export const BAND_EDGES_HZ = {
  low: [20, 250],
  mid: [250, 2000],
  high: [2000, 16_000],
} as const satisfies Record<string, readonly [number, number]>;

/** Lowest frequency treated as musical content, for centroid mapping. */
const CENTROID_FLOOR_HZ = 20;

/**
 * Energy features are scaled against this percentile of the track rather than
 * its absolute peak, so one transient cannot flatten everything else. Computed
 * over the whole track, which offline analysis makes possible.
 */
export const NORMALIZE_PERCENTILE = 0.95;

/**
 * Reference level below which a channel is treated as carrying no signal.
 *
 * Normalization is relative, so without a floor a channel holding only
 * spectral leakage — a bass-only track's high band, say — would be scaled up to
 * full range and manufacture motion out of numerical noise. Magnitudes are
 * amplitude-like on a 0..1 scale, so this sits roughly 80 dB down.
 */
export const SIGNAL_FLOOR = 1e-4;

/** One-pole smoothing time constant. */
export const SMOOTHING_SECONDS = 0.12;

/**
 * The shortest time a feature may take to traverse its full range.
 *
 * WCAG 2.3.1 (Level A) forbids content flashing more than three times per
 * second. A full traversal every 0.5s is at most one flash per second — a third
 * of that limit, with margin for effects that respond non-linearly.
 */
export const MIN_FULL_SWING_SECONDS = 0.5;

/**
 * Ceiling applied after smoothing. Below 1.0 so peaks land short of a
 * parameter's limit, which keeps motion from reading as harsh even at
 * maximum drive.
 */
export const MAX_FEATURE_AMPLITUDE = 0.85;

/** Safety limits for a given frame rate. Slew is per frame, so it depends on fps. */
export function deriveSafetyLimits(fps: number): SafetyLimits {
  if (!(fps > 0)) {
    throw new RangeError(`fps must be > 0, got ${fps}`);
  }
  return {
    maxDeltaPerFrame: MAX_FEATURE_AMPLITUDE / (MIN_FULL_SWING_SECONDS * fps),
    maxAmplitude: MAX_FEATURE_AMPLITUDE,
  };
}

/** Smoothing coefficient for a one-pole lowpass at a given frame rate. */
export function smoothingAlpha(fps: number, seconds = SMOOTHING_SECONDS): number {
  if (!(fps > 0)) {
    throw new RangeError(`fps must be > 0, got ${fps}`);
  }
  if (seconds <= 0) {
    return 1;
  }
  return 1 - Math.exp(-1 / (seconds * fps));
}

// --- Raw feature extraction ------------------------------------------------

/** Root mean square of a block of samples. */
export function rmsOf(samples: Float32Array): number {
  if (samples.length === 0) {
    return 0;
  }
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i]!;
    sum += sample * sample;
  }
  return Math.sqrt(sum / samples.length);
}

/**
 * Mean magnitude across a frequency band. Mean rather than sum, so a wide band
 * is not inherently louder than a narrow one.
 */
export function bandEnergy(
  magnitudes: Float32Array,
  fftSize: number,
  sampleRate: number,
  lowHz: number,
  highHz: number,
): number {
  const nyquist = sampleRate / 2;
  const from = Math.max(1, Math.ceil((lowHz * fftSize) / sampleRate));
  const to = Math.min(binCountFor(fftSize) - 1, Math.floor((Math.min(highHz, nyquist) * fftSize) / sampleRate));

  if (to < from) {
    return 0;
  }

  let sum = 0;
  for (let bin = from; bin <= to; bin += 1) {
    sum += magnitudes[bin]!;
  }
  return sum / (to - from + 1);
}

/**
 * Spectral centroid mapped to 0..1 logarithmically between 20 Hz and Nyquist.
 *
 * Log rather than linear because pitch is perceived logarithmically: a linear
 * mapping would leave almost all musical content bunched near zero.
 */
export function spectralCentroid(
  magnitudes: Float32Array,
  fftSize: number,
  sampleRate: number,
): number {
  let weighted = 0;
  let total = 0;
  for (let bin = 1; bin < magnitudes.length; bin += 1) {
    const magnitude = magnitudes[bin]!;
    weighted += magnitude * binFrequency(bin, fftSize, sampleRate);
    total += magnitude;
  }
  if (total <= 0) {
    return 0;
  }

  const centroidHz = weighted / total;
  const nyquist = sampleRate / 2;
  if (centroidHz <= CENTROID_FLOOR_HZ) {
    return 0;
  }
  const mapped = Math.log(centroidHz / CENTROID_FLOOR_HZ) / Math.log(nyquist / CENTROID_FLOOR_HZ);
  return Math.min(1, Math.max(0, mapped));
}

/**
 * Positive spectral flux — how much the spectrum gained energy since the
 * previous frame. Rises on note onsets and stays near zero on sustained sound.
 */
export function spectralFlux(magnitudes: Float32Array, previous: Float32Array): number {
  if (magnitudes.length !== previous.length) {
    throw new RangeError('flux needs two spectra of equal length');
  }
  let sum = 0;
  for (let bin = 1; bin < magnitudes.length; bin += 1) {
    const delta = magnitudes[bin]! - previous[bin]!;
    if (delta > 0) {
      sum += delta;
    }
  }
  return sum / Math.max(1, magnitudes.length - 1);
}

// --- Safety pipeline -------------------------------------------------------

/** Value at a percentile of the data, 0..1. Does not modify the input. */
export function percentileOf(values: Float32Array, percentile: number): number {
  if (values.length === 0) {
    return 0;
  }
  if (!(percentile >= 0) || !(percentile <= 1)) {
    throw new RangeError(`percentile must be within 0..1, got ${percentile}`);
  }
  const sorted = Float32Array.from(values).sort();
  const index = Math.round(percentile * (sorted.length - 1));
  return sorted[index]!;
}

/**
 * Scale a channel so its percentile reference becomes 1, clamping above.
 *
 * A track quiet throughout still gets full motion, which matters for the
 * ambient and sleep material this is built for. A channel with no real content
 * stays at zero rather than being amplified — see `SIGNAL_FLOOR`.
 */
export function normalizeByPercentileInPlace(
  values: Float32Array,
  percentile = NORMALIZE_PERCENTILE,
): void {
  const reference = percentileOf(values, percentile);
  if (reference < SIGNAL_FLOOR) {
    values.fill(0);
    return;
  }
  for (let i = 0; i < values.length; i += 1) {
    values[i] = Math.min(1, values[i]! / reference);
  }
}

/** One-pole lowpass, in place. `alpha` of 1 leaves the signal untouched. */
export function smoothInPlace(values: Float32Array, alpha: number): void {
  if (!(alpha > 0) || alpha > 1) {
    throw new RangeError(`alpha must be within 0..1, got ${alpha}`);
  }
  if (alpha === 1 || values.length === 0) {
    return;
  }
  let state = values[0]!;
  for (let i = 0; i < values.length; i += 1) {
    state += alpha * (values[i]! - state);
    values[i] = state;
  }
}

/**
 * Hard-limit how far a value may move between frames.
 *
 * This is the structural half of the no-strobe promise: whatever the input
 * does, the output cannot traverse its range faster than the limit allows.
 */
export function slewLimitInPlace(values: Float32Array, maxDeltaPerFrame: number): void {
  if (!(maxDeltaPerFrame > 0)) {
    throw new RangeError(`maxDeltaPerFrame must be > 0, got ${maxDeltaPerFrame}`);
  }
  if (values.length === 0) {
    return;
  }
  let previous = values[0]!;
  for (let i = 1; i < values.length; i += 1) {
    const target = values[i]!;
    const delta = target - previous;
    const limited =
      delta > maxDeltaPerFrame
        ? previous + maxDeltaPerFrame
        : delta < -maxDeltaPerFrame
          ? previous - maxDeltaPerFrame
          : target;
    values[i] = limited;
    previous = limited;
  }
}

/**
 * Largest Float32 value that is not above `max`.
 *
 * Clamping arithmetic happens in float64, but the result is stored as Float32,
 * and that rounding can go *up*: `Math.min(0.85, x)` written to a Float32Array
 * reads back as 0.8500000238. For a safety ceiling that must hold when read
 * back, the limit itself has to be a representable value at or below `max`.
 */
export function float32Ceiling(max: number): number {
  const rounded = Math.fround(max);
  if (rounded <= max) {
    return rounded;
  }
  // Step down at least one unit in the last place (Float32 has a 23-bit
  // mantissa), then re-round so the result is exactly representable.
  return Math.fround(rounded - Math.abs(rounded) * 2 ** -23);
}

/**
 * Clamp a channel into 0..max, such that the stored values genuinely satisfy
 * the bound rather than merely rounding to it.
 */
export function clampInPlace(values: Float32Array, max: number): void {
  const ceiling = float32Ceiling(max);
  for (let i = 0; i < values.length; i += 1) {
    values[i] = Math.min(ceiling, Math.max(0, values[i]!));
  }
}

// --- Timeline access -------------------------------------------------------

/** Read every feature at one frame. Frame indices are clamped to the timeline. */
export function sampleFeatures(timeline: FeatureTimeline, frameIndex: number): FeatureSample {
  const index = Math.min(timeline.frameCount - 1, Math.max(0, Math.trunc(frameIndex)));
  const sample = {} as Record<FeatureName, number>;
  for (const name of FEATURE_NAMES) {
    sample[name] = timeline.channels[name][index] ?? 0;
  }
  return sample;
}
