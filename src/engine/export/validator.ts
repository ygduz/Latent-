import type { ValidationCheck, ValidationReport } from '../types';
import { CANVAS_SPEC } from './spec';
import { Mp4ParseError, inspectMp4 } from './mp4Inspect';

/**
 * Export validation — the product's central promise, made checkable.
 *
 * Every rule here corresponds to something Spotify or Apple rejects uploads
 * for, or to a defect a listener would notice. It is pure: measurements are
 * gathered during the render, and this only judges them, so every rule can be
 * tested without a GPU.
 */

/**
 * Luminance change treated as a flash, as a fraction of full range.
 *
 * WCAG 2.3.1 defines a flash as a pair of opposing changes in relative
 * luminance of 10% or more. This is a screening check against that threshold,
 * not a certified PEAT analysis — it measures average frame luminance rather
 * than per-region, so it can miss a flash confined to a small area. Latent's
 * own output cannot flash at all (the analysis stage slew-limits every feature),
 * so this exists to prove that rather than to rescue a bad render.
 */
export const FLASH_THRESHOLD = 0.1;

/** WCAG 2.3.1 (Level A): no more than three flashes in any one-second period. */
export const MAX_FLASHES_PER_SECOND = 3;

/**
 * How much larger the wrap-around change may be than the largest change inside
 * the loop before it reads as a visible jump.
 */
export const SEAM_TOLERANCE = 1.5;

export interface ExportMeasurements {
  readonly durationSec: number;
  readonly fps: number;
  readonly frameCount: number;
  readonly width: number;
  readonly height: number;
  /** Mean relative luminance per frame, 0..1. */
  readonly luminance: readonly number[];
  /** Whether frame 0 came out identical to the untouched cover art. */
  readonly firstFrameMatchesCover: boolean;
}

/**
 * Flashes per second, taken as the worst one-second window.
 *
 * A run of changes in one direction is a fade, not a flash; only reversals
 * count, which is what "pair of opposing changes" means.
 */
export function flashesPerSecond(luminance: readonly number[], fps: number): number {
  if (!(fps > 0)) {
    throw new RangeError(`fps must be > 0, got ${fps}`);
  }
  if (luminance.length < 2) {
    return 0;
  }

  // Reduce the signal to significant moves, each recorded with its direction
  // and the frame it completed on.
  const moves: { readonly direction: number; readonly frame: number }[] = [];
  let anchor = luminance[0]!;
  for (let frame = 1; frame < luminance.length; frame += 1) {
    const delta = luminance[frame]! - anchor;
    if (Math.abs(delta) >= FLASH_THRESHOLD) {
      moves.push({ direction: Math.sign(delta), frame });
      anchor = luminance[frame]!;
    }
  }

  // Each direction reversal is one flash.
  const reversals: number[] = [];
  for (let i = 1; i < moves.length; i += 1) {
    if (moves[i]!.direction !== moves[i - 1]!.direction) {
      reversals.push(moves[i]!.frame);
    }
  }
  if (reversals.length === 0) {
    return 0;
  }

  let worst = 0;
  for (let i = 0; i < reversals.length; i += 1) {
    const windowEnd = reversals[i]! + fps;
    let count = 0;
    for (let j = i; j < reversals.length && reversals[j]! < windowEnd; j += 1) {
      count += 1;
    }
    worst = Math.max(worst, count);
  }
  return worst;
}

/**
 * How much the loop jumps when it repeats, relative to its own motion.
 *
 * Returns the wrap-around luminance change divided by the largest change inside
 * the loop, so a slow loop is not judged by the same absolute yardstick as a
 * lively one. Below 1 means the wrap is no more abrupt than the motion already
 * present.
 */
export function seamRatio(luminance: readonly number[]): number {
  if (luminance.length < 3) {
    return 0;
  }
  let largestInside = 0;
  for (let i = 1; i < luminance.length; i += 1) {
    largestInside = Math.max(largestInside, Math.abs(luminance[i]! - luminance[i - 1]!));
  }
  const wrap = Math.abs(luminance[0]! - luminance[luminance.length - 1]!);
  if (largestInside <= Number.EPSILON) {
    // A completely still loop cannot have a seam.
    return wrap <= Number.EPSILON ? 0 : Number.POSITIVE_INFINITY;
  }
  return wrap / largestInside;
}

const pass = (id: string, label: string, detail?: string): ValidationCheck => ({
  id,
  label,
  status: 'pass',
  ...(detail === undefined ? {} : { detail }),
});

const fail = (id: string, label: string, detail: string): ValidationCheck => ({
  id,
  label,
  status: 'fail',
  detail,
});

const skip = (id: string, label: string, detail: string): ValidationCheck => ({
  id,
  label,
  status: 'skipped',
  detail,
});

function containerChecks(bytes: Uint8Array): ValidationCheck[] {
  let info;
  try {
    info = inspectMp4(bytes);
  } catch (cause) {
    const reason = cause instanceof Mp4ParseError ? cause.message : 'unreadable';
    return [
      fail('container', 'Valid MP4 container', `The file could not be read as an MP4: ${reason}.`),
      skip('no-audio', 'No audio track', 'Could not read the container.'),
      skip('dimensions-file', 'Frame size recorded in the file', 'Could not read the container.'),
    ];
  }

  const checks: ValidationCheck[] = [];

  checks.push(
    info.hasFtyp
      ? pass('container', 'Valid MP4 container', info.brands.length > 0 ? `Brands: ${info.brands.join(', ')}.` : undefined)
      : fail('container', 'Valid MP4 container', 'No ftyp box, so this is not a recognisable MP4.'),
  );

  const video = info.tracks.filter((track) => track.handler === 'vide');
  const audio = info.tracks.filter((track) => track.handler === 'soun');

  checks.push(
    video.length === 1
      ? pass('video-track', 'One video track')
      : fail('video-track', 'One video track', `Found ${video.length} video tracks; Canvas needs exactly one.`),
  );

  checks.push(
    audio.length === 0
      ? pass('no-audio', 'No audio track', 'Canvas videos are silent by specification.')
      : fail('no-audio', 'No audio track', `Found ${audio.length} audio tracks; Canvas rejects any audio.`),
  );

  const dimensions = video[0];
  if (!dimensions || dimensions.width === undefined || dimensions.height === undefined) {
    checks.push(
      skip('dimensions-file', 'Frame size recorded in the file', 'The track header carried no dimensions.'),
    );
  } else {
    const { width, height } = dimensions;
    const expectedAspect = CANVAS_SPEC.aspectWidth / CANVAS_SPEC.aspectHeight;
    const aspectMatches = Math.abs(width / height - expectedAspect) < 0.01;
    const widthInRange = width >= CANVAS_SPEC.minWidthPx && width <= CANVAS_SPEC.maxWidthPx;

    checks.push(
      aspectMatches && widthInRange
        ? pass('dimensions-file', 'Frame size recorded in the file', `${width}×${height}, 9:16.`)
        : fail(
            'dimensions-file',
            'Frame size recorded in the file',
            `${width}×${height} is not 9:16 within ${CANVAS_SPEC.minWidthPx}–${CANVAS_SPEC.maxWidthPx}px wide.`,
          ),
    );
  }

  return checks;
}

/** Judge a finished export against the Spotify Canvas specification. */
export function validateCanvasExport(
  bytes: Uint8Array,
  measurements: ExportMeasurements,
): ValidationReport {
  const { durationSec, fps, frameCount, width, height, luminance } = measurements;
  const checks: ValidationCheck[] = [];

  const withinDuration =
    durationSec >= CANVAS_SPEC.minDurationSec && durationSec <= CANVAS_SPEC.maxDurationSec;
  checks.push(
    withinDuration
      ? pass('duration', 'Loop length within 3–8 seconds', `${durationSec.toFixed(2)}s.`)
      : fail(
          'duration',
          'Loop length within 3–8 seconds',
          `${durationSec.toFixed(2)}s is outside the ${CANVAS_SPEC.minDurationSec}–${CANVAS_SPEC.maxDurationSec}s window Spotify accepts.`,
        ),
  );

  const expectedAspect = CANVAS_SPEC.aspectWidth / CANVAS_SPEC.aspectHeight;
  const aspectMatches = Math.abs(width / height - expectedAspect) < 0.01;
  checks.push(
    aspectMatches
      ? pass('aspect', 'Vertical 9:16 frame', `${width}×${height}.`)
      : fail('aspect', 'Vertical 9:16 frame', `${width}×${height} is not 9:16.`),
  );

  // Frames must exactly cover the duration, or the loop drifts against the
  // audio it was built from.
  const expectedFrames = Math.round(durationSec * fps);
  checks.push(
    frameCount === expectedFrames
      ? pass('frame-count', 'Frames cover the loop exactly', `${frameCount} frames at ${fps} fps.`)
      : fail(
          'frame-count',
          'Frames cover the loop exactly',
          `${frameCount} frames for ${durationSec.toFixed(2)}s at ${fps} fps; expected ${expectedFrames}.`,
        ),
  );

  checks.push(
    measurements.firstFrameMatchesCover
      ? pass(
          'first-frame',
          'First frame is the untouched cover',
          'Required by Apple Motion Art, and what makes the loop start cleanly.',
        )
      : fail(
          'first-frame',
          'First frame is the untouched cover',
          'The first frame differs from the artwork. Apple rejects motion art whose first frame does not match the cover.',
        ),
  );

  const seam = seamRatio(luminance);
  checks.push(
    seam <= SEAM_TOLERANCE
      ? pass('seam', 'Loop repeats without a jump', `Wrap is ${seam.toFixed(2)}× the largest step inside the loop.`)
      : fail(
          'seam',
          'Loop repeats without a jump',
          `The wrap is ${seam.toFixed(2)}× the largest step inside the loop, which will read as a stutter on every repeat.`,
        ),
  );

  const flashes = flashesPerSecond(luminance, fps);
  checks.push(
    flashes <= MAX_FLASHES_PER_SECOND
      ? pass(
          'no-strobe',
          'No strobing',
          flashes === 0
            ? 'No flashes detected. Safe for photosensitive viewers.'
            : `${flashes} flashes per second, within the limit of ${MAX_FLASHES_PER_SECOND}.`,
        )
      : fail(
          'no-strobe',
          'No strobing',
          `${flashes} flashes per second exceeds the WCAG 2.3.1 limit of ${MAX_FLASHES_PER_SECOND}, and Apple rejects frenetic flashing.`,
        ),
  );

  checks.push(...containerChecks(bytes));

  return {
    target: 'spotify-canvas',
    checks,
    ok: checks.every((check) => check.status !== 'fail'),
  };
}
