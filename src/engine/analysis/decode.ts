export class AudioDecodeError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AudioDecodeError';
  }
}

/**
 * Sample rate all analysis runs at.
 *
 * Pinned rather than inherited from the device: `decodeAudioData` resamples to
 * its context's rate, and hardware rates vary (44.1 kHz, 48 kHz, more on some
 * phones). Pinning means the same file yields the same timeline — and therefore
 * the same video — on every machine.
 */
export const ANALYSIS_SAMPLE_RATE = 48_000;

/**
 * Decode an audio file to PCM, entirely in the browser.
 *
 * Nothing is uploaded: this is what lets an artist analyse an unreleased track
 * without it leaving their device.
 */
export async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  const context = new OfflineAudioContext({
    numberOfChannels: 1,
    length: 1,
    sampleRate: ANALYSIS_SAMPLE_RATE,
  });

  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch (cause) {
    throw new AudioDecodeError(`${file.name || 'That file'} could not be read.`, { cause });
  }

  let buffer: AudioBuffer;
  try {
    buffer = await context.decodeAudioData(bytes);
  } catch (cause) {
    throw new AudioDecodeError(
      `${file.name || 'That file'} could not be decoded as audio. Try WAV, MP3, FLAC or M4A.`,
      { cause },
    );
  }

  if (buffer.length === 0) {
    throw new AudioDecodeError(`${file.name || 'That file'} contains no audio.`);
  }

  return buffer;
}
