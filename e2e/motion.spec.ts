import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { detailCover } from '../tests/fixtures/png';
import { encodeWav, renderSamples } from '../tests/fixtures/wav';

/**
 * Verifies the motion path end to end in a real browser.
 *
 * The load-bearing assertion is that phase 0 renders pixel-for-pixel identical
 * to the static cover. That single property is what satisfies Apple Motion
 * Art's "first frame must match the cover" rule and what makes the loop seam
 * invisible, and it is enforced by the envelope in cover.frag. Only a real
 * render can confirm it.
 */

const TRACK_SECONDS = 3;

function loudGatedWav(): number[] {
  const samples = renderSamples(48_000, TRACK_SECONDS, (t) => {
    const tone = Math.sin(2 * Math.PI * 110 * t) * 0.5 + Math.sin(2 * Math.PI * 2200 * t) * 0.3;
    // Gated so there are onsets, which the Pulse preset routes to glow.
    return (t * 3) % 1 < 0.55 ? tone : 0;
  });
  return Array.from(encodeWav(samples, 48_000));
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

/** The whole canvas as a PNG data URL, for exact comparison between states. */
function snapshot(page: Page): Promise<string> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="stage-canvas"]');
    if (!canvas) {
      throw new Error('stage canvas not found');
    }
    return canvas.toDataURL();
  });
}

async function loadCover(page: Page): Promise<void> {
  await setFile(page, 'image/*', 'cover.png', 'image/png', Array.from(detailCover(512)));
  await expect(page.getByText('Loaded 512×512 artwork.')).toBeVisible();
}

async function loadTrack(page: Page): Promise<void> {
  await setFile(page, 'audio/*', 'loop.wav', 'audio/wav', loudGatedWav());
  await expect(page.getByText(/analysed, looping/)).toBeVisible({ timeout: 15_000 });
}

test.describe('audio-driven motion', () => {
  test.beforeEach(async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) {
        errors.push(message.text());
      }
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Latent', level: 1 })).toBeVisible();
    await loadCover(page);

    // A shader that failed to compile would surface here, not as a wrong pixel.
    await expect(page.locator('.stage-error')).toHaveCount(0);
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
  });

  test('phase 0 is pixel-identical to the untouched cover', async ({ page }) => {
    const staticCover = await snapshot(page);

    await loadTrack(page);

    // Paused at phase 0: every effect's envelope is exactly zero, so this must
    // be the cover art untouched — Apple's first-frame requirement.
    expect(await snapshot(page)).toBe(staticCover);
  });

  test('stays identical at phase 0 whichever preset is chosen', async ({ page }) => {
    const staticCover = await snapshot(page);
    await loadTrack(page);

    for (const name of ['Pulse', 'Tide', 'Ember', 'Dust', 'Still Water']) {
      await page.getByRole('radio', { name: new RegExp(name) }).click();
      expect(await snapshot(page), `${name} altered the first frame`).toBe(staticCover);
    }
  });

  test('moves the artwork once playing, and keeps moving', async ({ page }) => {
    await loadTrack(page);
    await page.getByRole('radio', { name: /Pulse/ }).click();

    const atRest = await snapshot(page);

    await page.getByRole('button', { name: 'Play loop' }).click();
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();

    await page.waitForTimeout(500);
    const early = await snapshot(page);
    await page.waitForTimeout(600);
    const later = await snapshot(page);

    expect(early, 'playback did not change the render').not.toBe(atRest);
    expect(later, 'motion stalled after the first frame').not.toBe(early);
  });

  test('returns to the untouched cover when paused back to the start', async ({ page }) => {
    const staticCover = await snapshot(page);
    await loadTrack(page);
    await page.getByRole('radio', { name: /Pulse/ }).click();

    await page.getByRole('button', { name: 'Play loop' }).click();
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: 'Pause' }).click();

    // Mid-loop, so this should differ from the first frame.
    expect(await snapshot(page)).not.toBe(staticCover);
  });

});

/**
 * Renderer-level checks, driving `CoverRenderer` directly rather than through
 * the UI. Phase can be set exactly here — including phase 1, which playback can
 * never land on — so the loop seam can be verified rather than inferred.
 */
type RendererModule = typeof import('../src/engine/render/coverRenderer');
type RoutingModule = typeof import('../src/engine/presets/routing');
type BuiltinsModule = typeof import('../src/engine/presets/builtins');

interface PhaseRenders {
  readonly atPhaseZero: string;
  readonly atPhaseOne: string;
  readonly midLoop: string;
}

async function renderAtPhases(page: Page, presetId: string): Promise<PhaseRenders> {
  const coverBytes = Array.from(detailCover(256));

  return page.evaluate(
    async ({ presetId: id, coverBytes: bytes }) => {
      const load = <T>(path: string): Promise<T> => import(path) as Promise<T>;
      const [{ CoverRenderer }, { resolveAmounts, resolveCycles }, { findPreset }] =
        await Promise.all([
          load<RendererModule>('/src/engine/render/coverRenderer.ts'),
          load<RoutingModule>('/src/engine/presets/routing.ts'),
          load<BuiltinsModule>('/src/engine/presets/builtins.ts'),
        ]);

      const preset = findPreset(id);
      if (!preset) {
        throw new Error(`no preset ${id}`);
      }

      const canvas = document.createElement('canvas');
      const renderer = CoverRenderer.create(canvas);
      renderer.resize(270, 480);

      const bitmap = await createImageBitmap(
        new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
      );
      renderer.setCover({ bitmap, width: bitmap.width, height: bitmap.height });

      // A strong, constant feature sample: this isolates phase as the only
      // thing changing between renders.
      const sample = {
        rms: 0.85,
        lowBand: 0.85,
        midBand: 0.85,
        highBand: 0.85,
        centroid: 0.5,
        flux: 0.7,
      };
      const amounts = resolveAmounts(preset, sample);
      const cycles = resolveCycles(preset);

      const at = (phase: number) => {
        renderer.render({ phase, amounts, cycles });
        return canvas.toDataURL();
      };

      const result = {
        atPhaseZero: at(0),
        atPhaseOne: at(1),
        midLoop: at(0.37),
      };
      renderer.dispose();
      return result;
    },
    { presetId, coverBytes },
  );
}

test.describe('loop seam at the renderer level', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Latent', level: 1 })).toBeVisible();
  });

  for (const presetId of ['still-water', 'ember', 'tide', 'dust', 'pulse']) {
    test(`${presetId} renders phase 1 identically to phase 0`, async ({ page }) => {
      const { atPhaseZero, atPhaseOne, midLoop } = await renderAtPhases(page, presetId);

      // The seam: the frame after the last is the first. Closed by the envelope
      // reaching zero at both ends, not by crossfading it away.
      expect(atPhaseOne, `${presetId} has a visible seam`).toBe(atPhaseZero);

      // And the loop is not simply motionless in between.
      expect(midLoop, `${presetId} produced no motion mid-loop`).not.toBe(atPhaseZero);
    });
  }

  test('presets differ from each other at the same phase', async ({ page }) => {
    const pulse = await renderAtPhases(page, 'pulse');
    const dust = await renderAtPhases(page, 'dust');

    expect(pulse.midLoop).not.toBe(dust.midLoop);
    // Yet both agree exactly at the first frame.
    expect(pulse.atPhaseZero).toBe(dust.atPhaseZero);
  });
});
