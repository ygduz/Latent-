import { describe, expect, it } from 'vitest';
import {
  FLASH_THRESHOLD,
  MAX_FLASHES_PER_SECOND,
  SEAM_TOLERANCE,
  flashesPerSecond,
  seamRatio,
  validateCanvasExport,
} from '../src/engine/export/validator';
import type { ExportMeasurements } from '../src/engine/export/validator';
import { CANVAS_EXPORT_DEFAULT } from '../src/engine/export/spec';
import { bytes, mp4File } from './fixtures/mp4';

const FPS = 30;

/** A gentle loop: luminance easing up and back, exactly closing. */
function calmLuminance(frameCount: number): number[] {
  return Array.from(
    { length: frameCount },
    (_unused, frame) => 0.4 + 0.05 * (0.5 - 0.5 * Math.cos((2 * Math.PI * frame) / frameCount)),
  );
}

function measurementsFor(overrides: Partial<ExportMeasurements> = {}): ExportMeasurements {
  const frameCount = overrides.frameCount ?? 150;
  return {
    durationSec: frameCount / FPS,
    fps: FPS,
    frameCount,
    width: CANVAS_EXPORT_DEFAULT.width,
    height: CANVAS_EXPORT_DEFAULT.height,
    luminance: calmLuminance(frameCount),
    firstFrameMatchesCover: true,
    ...overrides,
  };
}

const checkFor = (report: { checks: readonly { id: string; status: string; detail?: string }[] }, id: string) =>
  report.checks.find((check) => check.id === id);

describe('flashesPerSecond', () => {
  it('reports nothing for a still image', () => {
    expect(flashesPerSecond(new Array(90).fill(0.5), FPS)).toBe(0);
  });

  it('reports nothing for a gentle loop', () => {
    expect(flashesPerSecond(calmLuminance(150), FPS)).toBe(0);
  });

  it('does not count a slow fade as flashing', () => {
    // One long ramp across three seconds: many changes, no reversals.
    const fade = Array.from({ length: 90 }, (_unused, frame) => frame / 89);
    expect(flashesPerSecond(fade, FPS)).toBe(0);
  });

  it('counts a hard alternation as flashing', () => {
    // Full black to full white every other frame: the worst case there is.
    const strobe = Array.from({ length: 90 }, (_unused, frame) => (frame % 2 === 0 ? 0 : 1));
    expect(flashesPerSecond(strobe, FPS)).toBeGreaterThan(MAX_FLASHES_PER_SECOND);
  });

  it('ignores changes below the threshold', () => {
    const shimmer = Array.from({ length: 90 }, (_unused, frame) =>
      frame % 2 === 0 ? 0.5 : 0.5 + FLASH_THRESHOLD / 2,
    );
    expect(flashesPerSecond(shimmer, FPS)).toBe(0);
  });

  it('measures the worst second, not the average', () => {
    // Calm for two seconds, then a burst in the third.
    const calm = new Array(60).fill(0.5);
    const burst = Array.from({ length: 30 }, (_unused, frame) => (frame % 2 === 0 ? 0.2 : 0.8));
    expect(flashesPerSecond([...calm, ...burst], FPS)).toBeGreaterThan(MAX_FLASHES_PER_SECOND);
  });

  it('rejects a non-positive fps', () => {
    expect(() => flashesPerSecond([0.1, 0.9], 0)).toThrow(RangeError);
  });

  it('handles a signal too short to judge', () => {
    expect(flashesPerSecond([], FPS)).toBe(0);
    expect(flashesPerSecond([0.5], FPS)).toBe(0);
  });
});

describe('seamRatio', () => {
  it('is near zero for a loop that closes exactly', () => {
    expect(seamRatio(calmLuminance(150))).toBeLessThan(SEAM_TOLERANCE);
  });

  it('is zero for a completely still loop', () => {
    expect(seamRatio(new Array(90).fill(0.4))).toBe(0);
  });

  it('is large when the loop ends somewhere else than it started', () => {
    // A ramp that never returns: the wrap is a jump the size of the whole ramp.
    const ramp = Array.from({ length: 90 }, (_unused, frame) => frame / 89);
    expect(seamRatio(ramp)).toBeGreaterThan(SEAM_TOLERANCE);
  });

  it('judges the wrap against the loop’s own motion, not an absolute', () => {
    // Both signals end 0.1 above where they started, so both wrap by exactly
    // the same amount. The lively one moves that much every frame, so its wrap
    // is unremarkable; the smooth one's is a jump out of nowhere.
    const smooth = Array.from({ length: 60 }, (_unused, frame) => 0.3 + (0.1 * frame) / 59);
    const lively = Array.from({ length: 60 }, (_unused, frame) => (frame % 2 === 0 ? 0.3 : 0.4));

    expect(seamRatio(lively)).toBeLessThan(seamRatio(smooth));
    expect(seamRatio(lively)).toBeLessThanOrEqual(SEAM_TOLERANCE);
    expect(seamRatio(smooth)).toBeGreaterThan(SEAM_TOLERANCE);
  });

  it('handles a signal too short to judge', () => {
    expect(seamRatio([0.4, 0.5])).toBe(0);
  });
});

describe('validateCanvasExport', () => {
  it('passes a well-formed export', () => {
    const report = validateCanvasExport(mp4File({ durationSec: 5 }), measurementsFor());

    expect(report.ok).toBe(true);
    expect(report.target).toBe('spotify-canvas');
    for (const check of report.checks) {
      expect(check.status, `${check.id}: ${check.detail ?? ''}`).not.toBe('fail');
    }
  });

  it('covers every rule an upload can be rejected for', () => {
    const report = validateCanvasExport(mp4File(), measurementsFor());
    expect(report.checks.map((check) => check.id).sort()).toEqual([
      'aspect',
      'container',
      'dimensions-file',
      'duration',
      'first-frame',
      'frame-count',
      'no-audio',
      'no-strobe',
      'seam',
      'video-track',
    ]);
  });

  it('fails a loop that is too short or too long', () => {
    const tooShort = validateCanvasExport(
      mp4File({ durationSec: 2 }),
      measurementsFor({ frameCount: 60 }),
    );
    expect(checkFor(tooShort, 'duration')?.status).toBe('fail');
    expect(tooShort.ok).toBe(false);

    const tooLong = validateCanvasExport(
      mp4File({ durationSec: 12 }),
      measurementsFor({ frameCount: 360 }),
    );
    expect(checkFor(tooLong, 'duration')?.status).toBe('fail');
  });

  it('fails a frame that is not 9:16', () => {
    const report = validateCanvasExport(
      mp4File({ tracks: [{ handler: 'vide', width: 1920, height: 1080 }] }),
      measurementsFor({ width: 1920, height: 1080 }),
    );
    expect(checkFor(report, 'aspect')?.status).toBe('fail');
    expect(checkFor(report, 'dimensions-file')?.status).toBe('fail');
  });

  it('fails when the frame count does not cover the duration', () => {
    const report = validateCanvasExport(
      mp4File(),
      measurementsFor({ frameCount: 150, durationSec: 6 }),
    );
    expect(checkFor(report, 'frame-count')?.status).toBe('fail');
  });

  it('fails when the first frame is not the untouched cover', () => {
    const report = validateCanvasExport(
      mp4File(),
      measurementsFor({ firstFrameMatchesCover: false }),
    );
    const check = checkFor(report, 'first-frame');
    expect(check?.status).toBe('fail');
    expect(check?.detail).toMatch(/Apple/);
  });

  it('fails a loop with a visible seam', () => {
    const ramp = Array.from({ length: 150 }, (_unused, frame) => frame / 149);
    const report = validateCanvasExport(mp4File(), measurementsFor({ luminance: ramp }));
    expect(checkFor(report, 'seam')?.status).toBe('fail');
  });

  it('fails a strobing loop and names the standard', () => {
    const strobe = Array.from({ length: 150 }, (_unused, frame) => (frame % 2 === 0 ? 0 : 1));
    const report = validateCanvasExport(mp4File(), measurementsFor({ luminance: strobe }));
    const check = checkFor(report, 'no-strobe');
    expect(check?.status).toBe('fail');
    expect(check?.detail).toMatch(/WCAG 2\.3\.1/);
  });

  it('fails a file carrying an audio track', () => {
    const report = validateCanvasExport(
      mp4File({
        tracks: [
          { handler: 'vide', width: 1080, height: 1920 },
          { handler: 'soun' },
        ],
      }),
      measurementsFor(),
    );
    expect(checkFor(report, 'no-audio')?.status).toBe('fail');
    expect(report.ok).toBe(false);
  });

  it('fails a file with more than one video track', () => {
    const report = validateCanvasExport(
      mp4File({
        tracks: [
          { handler: 'vide', width: 1080, height: 1920 },
          { handler: 'vide', width: 1080, height: 1920 },
        ],
      }),
      measurementsFor(),
    );
    expect(checkFor(report, 'video-track')?.status).toBe('fail');
  });

  it('reports unreadable bytes as a failure rather than throwing', () => {
    const report = validateCanvasExport(bytes([1, 2, 3, 4, 5, 6, 7, 8, 9]), measurementsFor());
    expect(checkFor(report, 'container')?.status).toBe('fail');
    // The container checks that depend on parsing are skipped, not guessed at.
    expect(checkFor(report, 'no-audio')?.status).toBe('skipped');
    expect(report.ok).toBe(false);
  });

  it('says so plainly when nothing is wrong', () => {
    const report = validateCanvasExport(mp4File(), measurementsFor());
    expect(checkFor(report, 'no-strobe')?.detail).toMatch(/photosensitive/);
  });
});
