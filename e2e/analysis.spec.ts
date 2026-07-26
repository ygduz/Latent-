import { expect, test } from '@playwright/test';
import { encodeWav, renderSamples } from '../tests/fixtures/wav';

/**
 * Verifies the audio path in a real browser, which unit tests cannot: that
 * `decodeAudioData` works, that a real `AudioBuffer` satisfies the analyzer's
 * `PcmSource` interface at runtime, and that analysis is pinned to a fixed
 * sample rate regardless of the source file.
 *
 * Engine modules are imported directly from the dev server rather than through
 * the app UI, because there is no audio UI yet.
 */

/** Deliberately not 48 kHz, so decoding has to resample. */
const SOURCE_SAMPLE_RATE = 24_000;

/**
 * Engine modules are loaded at runtime by dev-server URL, which TypeScript
 * cannot resolve as a filesystem path. These type-only aliases keep the
 * in-page code fully typed anyway; they are erased at compile time.
 */
type DecodeModule = typeof import('../src/engine/analysis/decode');
type AnalyzerModule = typeof import('../src/engine/analysis/analyzer');
type FeaturesModule = typeof import('../src/engine/analysis/features');
type EngineTypes = typeof import('../src/engine/types');

function toneWav(durationSec: number): number[] {
  const samples = renderSamples(SOURCE_SAMPLE_RATE, durationSec, (t) => {
    const bass = Math.sin(2 * Math.PI * 60 * t) * 0.5;
    const bright = Math.sin(2 * Math.PI * 4000 * t) * 0.4;
    // Gated, so there are onsets for spectral flux to find.
    return (t * 4) % 1 < 0.6 ? bass + bright : 0;
  });
  return Array.from(encodeWav(samples, SOURCE_SAMPLE_RATE));
}

interface AnalysisResult {
  readonly decodedSampleRate: number;
  readonly frameCount: number;
  readonly maxima: Record<string, number>;
  readonly biggestStep: number;
  readonly slewLimit: number;
  readonly amplitudeLimit: number;
  readonly identicalOnRerun: boolean;
}

async function analyzeInBrowser(
  page: import('@playwright/test').Page,
  wavBytes: number[],
): Promise<AnalysisResult> {
  return page.evaluate(async (bytes) => {
    const load = <T>(path: string): Promise<T> => import(path) as Promise<T>;

    const [{ decodeAudioFile }, { analyze }, { deriveSafetyLimits }, { FEATURE_NAMES }] =
      await Promise.all([
        load<DecodeModule>('/src/engine/analysis/decode.ts'),
        load<AnalyzerModule>('/src/engine/analysis/analyzer.ts'),
        load<FeaturesModule>('/src/engine/analysis/features.ts'),
        load<EngineTypes>('/src/engine/types.ts'),
      ]);

    const file = new File([new Uint8Array(bytes)], 'tone.wav', { type: 'audio/wav' });
    const buffer = await decodeAudioFile(file);

    const fps = 30;
    const first = analyze(buffer, { fps });
    const second = analyze(buffer, { fps });
    const limits = deriveSafetyLimits(fps);

    const maxima: Record<string, number> = {};
    let biggestStep = 0;
    let identicalOnRerun = true;

    for (const name of FEATURE_NAMES) {
      const channel = first.channels[name];
      let max = 0;
      for (let i = 0; i < channel.length; i += 1) {
        max = Math.max(max, channel[i]!);
        if (i > 0) {
          biggestStep = Math.max(biggestStep, Math.abs(channel[i]! - channel[i - 1]!));
        }
        if (channel[i] !== second.channels[name][i]) {
          identicalOnRerun = false;
        }
      }
      maxima[name] = max;
    }

    return {
      decodedSampleRate: buffer.sampleRate,
      frameCount: first.frameCount,
      maxima,
      biggestStep,
      slewLimit: limits.maxDeltaPerFrame,
      amplitudeLimit: limits.maxAmplitude,
      identicalOnRerun,
    };
  }, wavBytes);
}

test.describe('audio analysis in the browser', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Latent', level: 1 })).toBeVisible();
  });

  test('decodes a real file and analyses it at a pinned sample rate', async ({ page }) => {
    const result = await analyzeInBrowser(page, toneWav(2));

    // Pinned, not inherited from the file or the device: the same input must
    // produce the same timeline on every machine.
    expect(result.decodedSampleRate).toBe(48_000);
    expect(result.frameCount).toBe(60);

    // A real AudioBuffer satisfied PcmSource, and the content came through.
    expect(result.maxima.lowBand!).toBeGreaterThan(0.5);
    expect(result.maxima.highBand!).toBeGreaterThan(0.5);
    expect(result.maxima.flux!).toBeGreaterThan(0);
  });

  test('holds the safety limits on real decoded audio', async ({ page }) => {
    const result = await analyzeInBrowser(page, toneWav(3));

    expect(result.biggestStep).toBeLessThanOrEqual(result.slewLimit + 1e-6);
    for (const [name, max] of Object.entries(result.maxima)) {
      expect(max, `${name} exceeded the amplitude ceiling`).toBeLessThanOrEqual(
        result.amplitudeLimit,
      );
    }
  });

  test('is deterministic across runs on the same input', async ({ page }) => {
    const result = await analyzeInBrowser(page, toneWav(2));
    expect(result.identicalOnRerun).toBe(true);
  });

  test('reports a readable error for a file that is not audio', async ({ page }) => {
    const message = await page.evaluate(async () => {
      const load = <T>(path: string): Promise<T> => import(path) as Promise<T>;
      const { decodeAudioFile } = await load<DecodeModule>('/src/engine/analysis/decode.ts');
      const file = new File(['definitely not audio'], 'notes.txt', { type: 'text/plain' });
      try {
        await decodeAudioFile(file);
        return 'no error thrown';
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    });

    expect(message).toContain('could not be decoded as audio');
  });
});
