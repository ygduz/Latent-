import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { detailCover } from '../tests/fixtures/png';
import { encodeWav, renderSamples } from '../tests/fixtures/wav';

/**
 * Verifies choosing which few seconds of a track to loop.
 *
 * A long fixture track is used so there is room to drag: the picker's whole job
 * is placing a 3–8 second window inside something much longer.
 */

const TRACK_SECONDS = 20;
/** Low rate keeps the fixture small; decoding resamples to 48 kHz regardless. */
const FIXTURE_SAMPLE_RATE = 8_000;

function longTrackWav(): number[] {
  const samples = renderSamples(FIXTURE_SAMPLE_RATE, TRACK_SECONDS, (t) => {
    // A slow build so different parts of the track look different in the strip.
    const swell = 0.2 + 0.8 * (0.5 - 0.5 * Math.cos((2 * Math.PI * t) / TRACK_SECONDS));
    const tone = Math.sin(2 * Math.PI * 110 * t) * 0.6 + Math.sin(2 * Math.PI * 1500 * t) * 0.3;
    return tone * swell * ((t * 2) % 1 < 0.6 ? 1 : 0.25);
  });
  return Array.from(encodeWav(samples, FIXTURE_SAMPLE_RATE));
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

/**
 * Centre of an element, in viewport coordinates.
 *
 * Scrolled into view first: mouse coordinates are viewport-relative, so an
 * element below the fold would otherwise be dragged at coordinates pointing at
 * nothing.
 */
async function centreOf(page: Page, testId: string): Promise<{ x: number; y: number }> {
  const locator = page.getByTestId(testId);
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error(`${testId} has no box`);
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function dragBy(page: Page, testId: string, deltaX: number): Promise<void> {
  const from = await centreOf(page, testId);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + deltaX, from.y, { steps: 8 });
  await page.mouse.up();
}

const loopNotice = (page: Page) => page.getByText(/analysed, looping/);

test.describe('loop segment picker', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Latent', level: 1 })).toBeVisible();

    await setFile(page, 'image/*', 'cover.png', 'image/png', Array.from(detailCover(256)));
    await setFile(page, 'audio/*', 'track.wav', 'audio/wav', longTrackWav());
    await expect(loopNotice(page)).toBeVisible({ timeout: 20_000 });
  });

  test('defaults to a five second loop from the start', async ({ page }) => {
    await expect(loopNotice(page)).toContainText('looping 5.0s from 0:00.0');
    await expect(page.getByText('0:00.0 → 0:05.0')).toBeVisible();
  });

  test('highlights only the selected span of the waveform', async ({ page }) => {
    const total = await page.locator('.segment-wave .bar').count();
    const inside = await page.locator('.segment-wave .bar.is-inside').count();

    expect(total).toBeGreaterThan(100);
    expect(inside).toBeGreaterThan(0);
    // A 5s window out of 20s is about a quarter of the strip.
    expect(inside).toBeLessThan(total / 2);
  });

  test('moves the loop when the window is dragged', async ({ page }) => {
    await dragBy(page, 'segment-window', 120);

    await expect(loopNotice(page)).not.toContainText('from 0:00.0');
    // Length is unchanged by a move.
    await expect(loopNotice(page)).toContainText('looping 5.0s');
  });

  test('does not restart playback until the drag is released', async ({ page }) => {
    // The picker holds a draft while dragging. Reporting every pointer move
    // would restart the audio dozens of times a second.
    const from = await centreOf(page, 'segment-window');
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 140, from.y, { steps: 8 });

    // Mid-drag: the readout follows the draft, but the committed loop has not moved.
    await expect(page.getByText('0:00.0 → 0:05.0')).toHaveCount(0);
    await expect(loopNotice(page)).toContainText('from 0:00.0');

    await page.mouse.up();
    await expect(loopNotice(page)).not.toContainText('from 0:00.0');
  });

  test('resizes the loop with the end handle', async ({ page }) => {
    await dragBy(page, 'segment-handle-end', 60);

    await expect(loopNotice(page)).toContainText('from 0:00.0');
    await expect(loopNotice(page)).not.toContainText('looping 5.0s');
  });

  test('holds the loop inside the platform duration limits', async ({ page }) => {
    // Drag the end well past the maximum; it must stop at eight seconds. The
    // distance stays inside the viewport so the pointer keeps tracking.
    await dragBy(page, 'segment-handle-end', 600);
    await expect(loopNotice(page)).toContainText('looping 8.0s');

    // And well below the minimum; it must stop at three.
    await dragBy(page, 'segment-handle-end', -600);
    await expect(loopNotice(page)).toContainText('looping 3.0s');
  });

  test('keeps the loop inside the track when dragged past the end', async ({ page }) => {
    // Far enough to overshoot the end of the track several times over.
    await dragBy(page, 'segment-window', 700);

    // The loop stops with its end flush against the end of the track, keeping
    // its length rather than being squashed.
    const lastStart = TRACK_SECONDS - 5;
    await expect(loopNotice(page)).toContainText(
      `looping 5.0s from 0:${lastStart.toFixed(1)}`,
    );
    await expect(
      page.getByText(`0:${lastStart.toFixed(1)} → 0:${TRACK_SECONDS.toFixed(1)}`),
    ).toBeVisible();
  });

  test('nudges the loop with the arrow keys', async ({ page }) => {
    const window = page.getByTestId('segment-window');
    await window.focus();

    await window.press('ArrowRight');
    await expect(loopNotice(page)).toContainText('from 0:00.1');

    // Shift moves in whole seconds.
    await window.press('Shift+ArrowRight');
    await expect(loopNotice(page)).toContainText('from 0:01.1');

    await window.press('ArrowLeft');
    await expect(loopNotice(page)).toContainText('from 0:01.0');
  });

  test('exposes the loop start to assistive technology', async ({ page }) => {
    const slider = page.getByRole('slider', { name: 'Loop start' });
    await expect(slider).toHaveAttribute('aria-valuenow', '0');
    await expect(slider).toHaveAttribute('aria-valuemax', '15');

    await slider.press('Shift+ArrowRight');
    await expect(slider).toHaveAttribute('aria-valuenow', '1');
  });

  test('sets the length with the range control', async ({ page }) => {
    await page.getByRole('slider', { name: /Length/ }).fill('7.5');
    await expect(loopNotice(page)).toContainText('looping 7.5s');
    await expect(page.getByText('0:00.0 → 0:07.5')).toBeVisible();
  });

  test('keeps playing when the loop changes', async ({ page }) => {
    await page.getByRole('button', { name: 'Play loop' }).click();
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();

    await dragBy(page, 'segment-window', 100);

    // Changing the segment restarts the source; it must not stop playback.
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  });
});
