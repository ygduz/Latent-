import type { PcmSource } from './analyzer';
import { SIGNAL_FLOOR } from './features';

/**
 * Waveform peaks for the segment picker.
 *
 * Computed straight from the source's channel data rather than from a mono
 * mixdown: a mixdown of a five-minute track is tens of megabytes, and this only
 * needs one number per bucket. Nothing is copied.
 */

/**
 * Peak amplitude per bucket, normalized to 0..1.
 *
 * Normalized against the track's own loudest point so a quiet recording still
 * shows a readable shape — the same reasoning as the feature normalization, and
 * the same floor, so a silent track reads as silent instead of as amplified
 * noise.
 */
export function computePeaks(source: PcmSource, bucketCount: number): Float32Array {
  if (!Number.isInteger(bucketCount) || bucketCount < 1) {
    throw new RangeError(`bucketCount must be a positive integer, got ${bucketCount}`);
  }

  const peaks = new Float32Array(bucketCount);
  if (source.length === 0) {
    return peaks;
  }

  const channelCount = Math.max(1, source.numberOfChannels);
  const channels: Float32Array[] = [];
  for (let channel = 0; channel < channelCount; channel += 1) {
    channels.push(source.getChannelData(channel));
  }

  let loudest = 0;
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const from = Math.floor((bucket * source.length) / bucketCount);
    const to = Math.max(from + 1, Math.floor(((bucket + 1) * source.length) / bucketCount));

    let peak = 0;
    for (const data of channels) {
      const end = Math.min(to, data.length);
      for (let i = from; i < end; i += 1) {
        const magnitude = Math.abs(data[i]!);
        if (magnitude > peak) {
          peak = magnitude;
        }
      }
    }
    peaks[bucket] = peak;
    if (peak > loudest) {
      loudest = peak;
    }
  }

  if (loudest < SIGNAL_FLOOR) {
    peaks.fill(0);
    return peaks;
  }

  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    peaks[bucket] = Math.min(1, peaks[bucket]! / loudest);
  }
  return peaks;
}

/**
 * Buckets to compute for the picker strip.
 *
 * Fixed rather than derived from the element's width, so the waveform is
 * computed once per track and simply stretches when the layout changes.
 */
export const WAVEFORM_BUCKETS = 400;
