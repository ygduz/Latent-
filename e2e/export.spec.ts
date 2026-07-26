import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { detailCover } from '../tests/fixtures/png';
import { encodeWav, renderSamples } from '../tests/fixtures/wav';

/**
 * Verifies the export end to end: that a real MP4 comes out, that the browser
 * itself can play it back, that it carries no audio track, and that two runs
 * over the same input produce byte-identical files.
 *
 * The determinism check is the one that matters most — it is the product's
 * central claim, and nothing short of encoding twice can demonstrate it.
 */

type Mp4InspectModule = typeof import('../src/engine/export/mp4Inspect');

/** Kept short: every frame is rendered and encoded in software here. */
const LOOP_SECONDS = 3;
const EXPORT_TIMEOUT_MS = 180_000;

function trackWav(): number[] {
  const samples = renderSamples(16_000, 8, (t) => {
    const tone = Math.sin(2 * Math.PI * 110 * t) * 0.5 + Math.sin(2 * Math.PI * 1600 * t) * 0.25;
    return tone * ((t * 2) % 1 < 0.55 ? 1 : 0.3);
  });
  return Array.from(encodeWav(samples, 16_000));
}

async function setFile(
  page: Page,
  accept: string,
  name: string,
  mimeType: string,
  bytes: number[],
): Promise<void> {
  await page.evaluate(
    ({ accept: selector, name: fileName, mimeType: type, bytes: data }) => {
      const input = document.querySelector<HTMLInputElement>(`input[accept="${selector}"]`);
      if (!input) {
        throw new Error(`no file input accepting ${selector}`);
      }
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(data)], fileName, { type }));
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    { accept, name, mimeType, bytes },
  );
}

interface FileFacts {
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly playbackWidth: number;
  readonly playbackHeight: number;
  readonly playbackDuration: number;
  readonly handlers: readonly string[];
  readonly trackWidth?: number;
  readonly trackHeight?: number;
  readonly containerDuration: number | null;
}

/** Read the exported file back: hash it, inspect it, and play it. */
async function inspectExport(page: Page): Promise<FileFacts> {
  const href = await page.getByRole('link', { name: /Download/ }).getAttribute('href');
  expect(href, 'no download link').toBeTruthy();

  return page.evaluate(async (url) => {
    const load = <T>(path: string): Promise<T> => import(path) as Promise<T>;
    const { inspectMp4 } = await load<Mp4InspectModule>('/src/engine/export/mp4Inspect.ts');

    const response = await fetch(url);
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const sha256 = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');

    const info = inspectMp4(bytes);

    // The real proof the file is valid: the browser demuxes and decodes it.
    const video = document.createElement('video');
    video.muted = true;
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('the browser could not load the exported video'));
      setTimeout(() => reject(new Error('timed out loading the exported video')), 20_000);
    });

    const videoTrack = info.tracks.find((track) => track.handler === 'vide');

    return {
      sizeBytes: bytes.byteLength,
      sha256,
      playbackWidth: video.videoWidth,
      playbackHeight: video.videoHeight,
      playbackDuration: video.duration,
      handlers: info.tracks.map((track) => track.handler),
      ...(videoTrack?.width === undefined ? {} : { trackWidth: videoTrack.width }),
      ...(videoTrack?.height === undefined ? {} : { trackHeight: videoTrack.height }),
      containerDuration: info.durationSec,
    };
  }, href!);
}

async function runExport(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Export MP4' }).click();
  await expect(page.getByRole('link', { name: /Download/ })).toBeVisible({
    timeout: EXPORT_TIMEOUT_MS,
  });
}

test.describe('MP4 export', () => {
  test.setTimeout(EXPORT_TIMEOUT_MS + 60_000);

  test.beforeEach(async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Latent', level: 1 })).toBeVisible();

    await setFile(page, 'image/*', 'cover.png', 'image/png', Array.from(detailCover(512)));
    await setFile(page, 'audio/*', 'slow-tide.wav', 'audio/wav', trackWav());
    await expect(page.getByText(/analysed, looping/)).toBeVisible({ timeout: 20_000 });

    // Shortest permitted loop, so the software encode stays quick.
    await page.getByRole('slider', { name: /Length/ }).fill(String(LOOP_SECONDS));
    await expect(page.getByText(/analysed, looping/)).toContainText(`looping ${LOOP_SECONDS}.0s`);

    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
  });

  test('produces an on-spec MP4 the browser can play', async ({ page }) => {
    await runExport(page);

    const facts = await inspectExport(page);

    // Playable, and at the size Spotify expects.
    expect(facts.playbackWidth).toBe(1080);
    expect(facts.playbackHeight).toBe(1920);
    expect(facts.playbackDuration).toBeCloseTo(LOOP_SECONDS, 1);

    // Exactly one video track and no audio, per the Canvas specification.
    expect(facts.handlers).toEqual(['vide']);
    expect(facts.trackWidth).toBe(1080);
    expect(facts.trackHeight).toBe(1920);
    expect(facts.containerDuration).toBeCloseTo(LOOP_SECONDS, 1);

    expect(facts.sizeBytes).toBeGreaterThan(10_000);
  });

  test('reports every specification check as passing', async ({ page }) => {
    await runExport(page);

    await expect(page.getByRole('heading', { name: 'Ready for Spotify Canvas' })).toBeVisible();

    // No check may fail, and the ones that carry the product's promises must
    // be present and passing rather than skipped.
    await expect(page.locator('.check.is-fail')).toHaveCount(0);
    for (const label of [
      'Loop length within 3–8 seconds',
      'Vertical 9:16 frame',
      'First frame is the untouched cover',
      'Loop repeats without a jump',
      'No strobing',
      'No audio track',
      'Valid MP4 container',
    ]) {
      await expect(page.locator('.check.is-pass').filter({ hasText: label })).toHaveCount(1);
    }
  });

  test('names the file after the track and preset', async ({ page }) => {
    await page.getByRole('radio', { name: /Ember/ }).click();
    await runExport(page);

    const link = page.getByRole('link', { name: /Download/ });
    await expect(link).toHaveAttribute('download', 'slow-tide-ember-canvas.mp4');
  });

  test('is deterministic: the same input encodes to the same bytes', async ({ page }) => {
    await runExport(page);
    const first = await inspectExport(page);

    // Export again from the identical state.
    await runExport(page);
    const second = await inspectExport(page);

    expect(second.sizeBytes).toBe(first.sizeBytes);
    expect(second.sha256, 'two exports of the same input differed').toBe(first.sha256);
  });

  test('a different preset produces a different file', async ({ page }) => {
    await runExport(page);
    const stillWater = await inspectExport(page);

    await page.getByRole('radio', { name: /Pulse/ }).click();
    // Changing the preset retires the previous file rather than leaving a stale
    // download pointing at the wrong render.
    await expect(page.getByRole('link', { name: /Download/ })).toHaveCount(0);

    await runExport(page);
    const pulse = await inspectExport(page);

    expect(pulse.sha256).not.toBe(stillWater.sha256);
  });

  test('retires the finished file when the loop changes', async ({ page }) => {
    await runExport(page);
    await expect(page.getByRole('link', { name: /Download/ })).toBeVisible();

    await page.getByRole('slider', { name: /Length/ }).fill('4');
    await expect(page.getByRole('link', { name: /Download/ })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Ready for Spotify Canvas' })).toHaveCount(0);
  });
});
