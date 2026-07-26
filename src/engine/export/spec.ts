import type { ExportSpec } from '../types';

/**
 * Spotify Canvas platform requirements, in one place.
 *
 * Verified against Spotify for Artists guidance, July 2026: 9:16 vertical,
 * 3–8 seconds, MP4/H.264, no audio track, 720×1280 minimum and 1080×1920
 * recommended. These are the numbers the validator checks against and the
 * export defaults are derived from — they must not be duplicated elsewhere.
 */
export const CANVAS_SPEC = {
  aspectWidth: 9,
  aspectHeight: 16,
  minDurationSec: 3,
  maxDurationSec: 8,
  /** Accepted frame widths: 720 (minimum) to 1080 (recommended ceiling). */
  minWidthPx: 720,
  maxWidthPx: 1080,
  container: 'mp4',
  videoCodec: 'h264',
  /** Canvas videos carry no audio track. */
  allowsAudio: false,
} as const;

/**
 * Default export target: the top of Spotify's accepted range. Exporting above
 * 1080×1920 gains nothing — Spotify does not use the extra pixels.
 */
export const CANVAS_EXPORT_DEFAULT: ExportSpec = {
  width: 1080,
  height: 1920,
  fps: 30,
  bitrate: 10_000_000,
};
