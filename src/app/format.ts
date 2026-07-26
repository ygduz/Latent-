/** Presentation helpers. Formatting is UI, so it lives in the app layer. */

/** `m:ss.t` — precise enough to place a loop, short enough to sit inline. */
export function formatSeconds(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const minutes = Math.floor(safe / 60);
  const seconds = safe - minutes * 60;
  return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`;
}
