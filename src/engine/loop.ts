import type { LoopSegment, Normalized, Seconds } from './types';
import { CANVAS_SPEC } from './export/spec';

/**
 * Loop-phase math.
 *
 * Every autonomous motion in the engine (drift paths, breathing, vignette
 * pulse) is a function of loop *phase* rather than absolute time. Because
 * phase wraps exactly to 0 at the end of the loop, the frame after the last
 * rendered frame is identical to frame 0 — the seam is closed by construction
 * rather than by crossfading it away afterwards.
 */

/**
 * Position within the loop as 0..1.
 *
 * Wraps exactly: `loopPhase(d, d) === 0`, which is the invariant the seamless
 * loop guarantee rests on. Negative times wrap forward, so scrubbing before
 * the segment start stays well-defined.
 */
export function loopPhase(timeSec: Seconds, durationSec: Seconds): Normalized {
  if (!(durationSec > 0)) {
    throw new RangeError(`loop duration must be > 0, got ${durationSec}`);
  }
  const phase = (timeSec / durationSec) % 1;
  return phase < 0 ? phase + 1 : phase;
}

/**
 * How many frames to render for a loop.
 *
 * The final frame is deliberately excluded: at `durationSec` the phase has
 * wrapped back to 0, so rendering it would duplicate frame 0 and produce a
 * visible one-frame stutter on every repeat.
 */
export function frameCountForLoop(durationSec: Seconds, fps: number): number {
  if (!(durationSec > 0)) {
    throw new RangeError(`loop duration must be > 0, got ${durationSec}`);
  }
  if (!(fps > 0)) {
    throw new RangeError(`fps must be > 0, got ${fps}`);
  }
  return Math.round(durationSec * fps);
}

/** Timestamp of a frame within the loop, in seconds from the loop start. */
export function frameTime(frameIndex: number, fps: number): Seconds {
  if (!(fps > 0)) {
    throw new RangeError(`fps must be > 0, got ${fps}`);
  }
  return frameIndex / fps;
}

/**
 * Loop length chosen when the artist has not picked one.
 *
 * Five seconds sits in the middle of Spotify's 3–8 second window, which is
 * where a loop is long enough not to feel like a stutter and short enough that
 * a listener does not notice it repeating.
 */
export const PREFERRED_DURATION_SEC = 5;

/** A starting segment for a track of a given length. */
export function defaultSegment(trackDurationSec: Seconds): LoopSegment {
  const durationSec = Math.min(
    Math.max(Math.min(PREFERRED_DURATION_SEC, trackDurationSec), 0),
    CANVAS_SPEC.maxDurationSec,
  );
  return { startSec: 0, durationSec };
}

/**
 * Pull a segment inside both the track and the platform's duration limits.
 *
 * A track shorter than the minimum loop cannot be made to satisfy it, so the
 * whole track is returned and the export validator reports the problem rather
 * than this silently inventing audio that is not there.
 */
export function clampSegment(segment: LoopSegment, trackDurationSec: Seconds): LoopSegment {
  const longestPossible = Math.min(trackDurationSec, CANVAS_SPEC.maxDurationSec);
  const durationSec = Math.min(
    Math.max(segment.durationSec, Math.min(CANVAS_SPEC.minDurationSec, trackDurationSec)),
    longestPossible,
  );
  const startSec = Math.min(Math.max(segment.startSec, 0), Math.max(0, trackDurationSec - durationSec));
  return { startSec, durationSec };
}

/**
 * Index into a whole-track feature timeline for a position within a segment.
 *
 * Preview and export share this so that what is previewed is what is exported.
 */
export function timelineFrameFor(
  segment: LoopSegment,
  phase: Normalized,
  fps: number,
): number {
  if (!(fps > 0)) {
    throw new RangeError(`fps must be > 0, got ${fps}`);
  }
  return Math.round((segment.startSec + phase * segment.durationSec) * fps);
}
