/**
 * Minimal 16-bit PCM WAV encoder for test fixtures.
 *
 * Dependency-free for the same reasons as the PNG encoder: it runs in both
 * Vitest and the browser, and the project needs no image or audio libraries.
 */

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

/** Encode mono float samples (-1..1) as a 16-bit PCM WAV file. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytesPerSample = 2;
  const dataBytes = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');

  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true); // byte rate
  view.setUint16(32, bytesPerSample, true); // block align
  view.setUint16(34, 16, true); // bits per sample

  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]!));
    // Asymmetric scaling: 16-bit signed holds -32768..32767.
    view.setInt16(44 + i * bytesPerSample, Math.round(clamped * (clamped < 0 ? 32768 : 32767)), true);
  }

  return new Uint8Array(buffer);
}

/** Render a generator function to samples, for feeding `encodeWav`. */
export function renderSamples(
  sampleRate: number,
  durationSec: number,
  sample: (timeSec: number) => number,
): Float32Array {
  const samples = new Float32Array(Math.round(sampleRate * durationSec));
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = sample(i / sampleRate);
  }
  return samples;
}
