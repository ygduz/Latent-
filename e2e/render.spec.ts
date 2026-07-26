import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { quadrantCover } from '../tests/fixtures/png';

/**
 * Verifies the static render on a real GPU (SwiftShader), which the unit tests
 * cannot: shader correctness, texture upload, and — most importantly — image
 * orientation. The fixture's four quadrants are distinct colours, so a flipped
 * or mis-cropped texture shows up as the wrong colour rather than passing
 * silently.
 */

const ART_SIZE = 64;

/** Frame-space y bounds of the contained artwork: square art in a 9:16 frame. */
const ART_TOP = (1 - 9 / 16) / 2; // 0.21875
const ART_BOTTOM = 1 - ART_TOP;

const RED = [220, 60, 60] as const;
const GREEN = [60, 200, 90] as const;
const BLUE = [70, 110, 230] as const;
const YELLOW = [230, 200, 70] as const;

/** Load the fixture artwork through the real file input. */
async function loadFixtureCover(page: Page): Promise<void> {
  // Bytes are generated here and passed as a plain array: the fixture encoder
  // is dependency-free, so it runs in the page without any Node types.
  const bytes = Array.from(quadrantCover(ART_SIZE));

  await page.evaluate((data) => {
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) {
      throw new Error('file input not found');
    }
    const file = new File([new Uint8Array(data)], 'cover.png', { type: 'image/png' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, bytes);

  await expect(page.getByText(`Loaded ${ART_SIZE}×${ART_SIZE} artwork.`)).toBeVisible();
}

/** Read one pixel from the stage, addressed in frame space (0..1, top-left origin). */
async function probe(page: Page, x: number, y: number): Promise<[number, number, number]> {
  return page.evaluate(([px, py]) => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="stage-canvas"]');
    if (!canvas) {
      throw new Error('stage canvas not found');
    }
    // The GL canvas keeps its drawing buffer, so it can be copied into a 2D
    // context to read pixels back.
    const scratch = document.createElement('canvas');
    scratch.width = canvas.width;
    scratch.height = canvas.height;
    const ctx = scratch.getContext('2d');
    if (!ctx) {
      throw new Error('2d context unavailable');
    }
    ctx.drawImage(canvas, 0, 0);

    const sx = Math.round(px! * (canvas.width - 1));
    const sy = Math.round(py! * (canvas.height - 1));
    const [r, g, b] = ctx.getImageData(sx, sy, 1, 1).data;
    return [r!, g!, b!] as [number, number, number];
  }, [x, y] as const);
}

function expectColorNear(
  actual: readonly [number, number, number],
  expected: readonly [number, number, number],
  tolerance = 14,
): void {
  const channels = ['red', 'green', 'blue'] as const;
  actual.forEach((value, index) => {
    expect(
      Math.abs(value - expected[index]!),
      `${channels[index]} channel: got ${actual.join(',')}, expected ~${expected.join(',')}`,
    ).toBeLessThanOrEqual(tolerance);
  });
}

test.describe('static cover render', () => {
  test.beforeEach(async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      // Only real script errors. Failed network requests surface here too, and
      // they say nothing about whether the renderer works.
      if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) {
        errors.push(message.text());
      }
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Latent', level: 1 })).toBeVisible();

    // Surface renderer failures (shader compile, missing uniform) immediately.
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
  });

  test('draws the artwork right side up, contained at full width', async ({ page }) => {
    await loadFixtureCover(page);

    // Probes sit at the centre of each quadrant of the contained artwork, well
    // away from quadrant boundaries so linear filtering cannot blur them.
    const upperY = ART_TOP + (ART_BOTTOM - ART_TOP) * 0.25;
    const lowerY = ART_TOP + (ART_BOTTOM - ART_TOP) * 0.75;

    // If the texture were flipped vertically, the top row would read blue and
    // yellow instead of red and green.
    expectColorNear(await probe(page, 0.25, upperY), RED);
    expectColorNear(await probe(page, 0.75, upperY), GREEN);
    expectColorNear(await probe(page, 0.25, lowerY), BLUE);
    expectColorNear(await probe(page, 0.75, lowerY), YELLOW);
  });

  test('fills the letterbox with a dimmed backdrop rather than bars', async ({ page }) => {
    await loadFixtureCover(page);

    // Above the artwork, the frame shows the cover-fitted backdrop. At x=0.25
    // the cover fit samples the artwork's left half, so this is a dimmed red.
    const backdrop = await probe(page, 0.25, 0.04);
    const artwork = await probe(page, 0.25, ART_TOP + 0.05);

    expectColorNear(backdrop, [RED[0] * 0.32, RED[1] * 0.32, RED[2] * 0.32]);

    // Same hue, materially darker — that is what makes it read as a backdrop.
    expect(backdrop[0]).toBeGreaterThan(backdrop[1]);
    expect(backdrop[0]).toBeLessThan(artwork[0] * 0.6);
  });

  test('warns about low-resolution artwork without blocking the render', async ({ page }) => {
    await loadFixtureCover(page);

    await expect(page.getByText(/will be upscaled and may look soft/)).toBeVisible();
    // The render still happened despite the warning.
    expectColorNear(await probe(page, 0.25, ART_TOP + 0.05), RED);
  });

  test('rejects a non-image file with a readable message', async ({ page }) => {
    await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>('input[type="file"]');
      if (!input) {
        throw new Error('file input not found');
      }
      const file = new File(['not an image'], 'notes.txt', { type: 'text/plain' });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await expect(page.getByRole('alert')).toContainText('is not an image');
  });
});
