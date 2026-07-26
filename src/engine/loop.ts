import type { Normalized, Seconds } from './types';

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
