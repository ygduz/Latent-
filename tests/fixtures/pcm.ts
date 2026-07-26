import type { PcmSource } from '../../src/engine/analysis/analyzer';

/**
 * Synthetic PCM fixtures.
 *
 * The analyzer takes a structural `PcmSource`, so tests can feed it exactly
 * known signals with no Web Audio, no files and no browser involved.
 */

export type SampleFn = (timeSec: number, channel: number) => number;

class SyntheticPcm implements PcmSource {
  private readonly data: Float32Array[];

  constructor(
    readonly sampleRate: number,
    readonly length: number,
    readonly numberOfChannels: number,
    sample: SampleFn,
  ) {
    this.data = Array.from({ length: numberOfChannels }, (_unused, channel) => {
      const channelData = new Float32Array(length);
      for (let i = 0; i < length; i += 1) {
        channelData[i] = sample(i / sampleRate, channel);
      }
      return channelData;
    });
  }

  getChannelData(channel: number): Float32Array {
    const data = this.data[channel];
    if (!data) {
      throw new RangeError(`no channel ${channel}`);
    }
    return data;
  }
}

export interface PcmOptions {
  readonly sampleRate?: number;
  readonly durationSec?: number;
  readonly channels?: number;
}

export function makePcm(sample: SampleFn, options: PcmOptions = {}): PcmSource {
  const { sampleRate = 48_000, durationSec = 2, channels = 1 } = options;
  return new SyntheticPcm(
    sampleRate,
    Math.round(sampleRate * durationSec),
    channels,
    sample,
  );
}

export const silence: SampleFn = () => 0;

export function sine(frequencyHz: number, amplitude = 1): SampleFn {
  return (timeSec) => amplitude * Math.sin(2 * Math.PI * frequencyHz * timeSec);
}

/** Two tones at once, for band-separation tests. */
export function sum(...parts: readonly SampleFn[]): SampleFn {
  return (timeSec, channel) => parts.reduce((total, part) => total + part(timeSec, channel), 0);
}

/**
 * Alternating full-scale bursts and silence — the most strobe-provoking input
 * available. Used to prove the safety limits hold under the worst case.
 */
export function burstTrain(burstsPerSecond: number): SampleFn {
  return (timeSec) => {
    const phase = (timeSec * burstsPerSecond) % 1;
    return phase < 0.5 ? Math.sin(2 * Math.PI * 220 * timeSec) : 0;
  };
}

/**
 * Switch a signal on and off repeatedly. Steady tones have no onsets and so no
 * spectral flux; gating them gives content in every feature at once.
 */
export function gate(part: SampleFn, gatesPerSecond: number, dutyCycle = 0.6): SampleFn {
  return (timeSec, channel) =>
    (timeSec * gatesPerSecond) % 1 < dutyCycle ? part(timeSec, channel) : 0;
}

/** Different content per channel, for mixdown tests. */
export function perChannel(...parts: readonly SampleFn[]): SampleFn {
  return (timeSec, channel) => (parts[channel] ?? silence)(timeSec, channel);
}
