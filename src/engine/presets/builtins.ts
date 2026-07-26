import type { Preset } from '../types';

/**
 * The calm preset family.
 *
 * Each one is deliberately restrained: two or three effects, low drive, and
 * slow cycle counts. The genres this is built for — ambient, lo-fi, classical,
 * meditation — want motion that does not compete with the artwork, and Apple
 * rejects motion art with "frenetic flashing" outright.
 *
 * Drive values above 1 are safe here because features are already normalized,
 * smoothed and slew-limited before routing sees them: the ceiling is on rate of
 * change, not on how eagerly a route responds.
 */

export const STILL_WATER: Preset = {
  schemaVersion: 1,
  id: 'still-water',
  name: 'Still Water',
  description: 'A slow drift with a breathing vignette. The quietest of the set.',
  routes: [
    { source: 'rms', target: 'drift.amount', base: 0.25, drive: 0.5, smooth: 0.6 },
    { source: 'rms', target: 'vignette.amount', base: 0.15, drive: 0.4, smooth: 0.7 },
  ],
  cycles: { drift: 1, vignette: 1 },
};

export const EMBER: Preset = {
  schemaVersion: 1,
  id: 'ember',
  name: 'Ember',
  description: 'Low end lifts a warm glow, with film grain over the top.',
  routes: [
    { source: 'lowBand', target: 'glow.amount', base: 0.1, drive: 0.8, smooth: 0.5 },
    { source: 'highBand', target: 'grain.amount', base: 0.2, drive: 0.5, smooth: 0.4 },
  ],
  cycles: { glow: 1, grain: 2 },
};

export const TIDE: Preset = {
  schemaVersion: 1,
  id: 'tide',
  name: 'Tide',
  description: 'Mids drive a gentle liquid ripple against a slow swell.',
  routes: [
    { source: 'midBand', target: 'ripple.amount', base: 0.2, drive: 0.7, smooth: 0.6 },
    { source: 'rms', target: 'breathe.amount', base: 0.2, drive: 0.5, smooth: 0.7 },
  ],
  cycles: { ripple: 2, breathe: 1 },
};

export const DUST: Preset = {
  schemaVersion: 1,
  id: 'dust',
  name: 'Dust',
  description: 'Grain that answers the top end, drifting very slightly.',
  routes: [
    { source: 'highBand', target: 'grain.amount', base: 0.3, drive: 0.6, smooth: 0.4 },
    { source: 'rms', target: 'drift.amount', base: 0.15, drive: 0.3, smooth: 0.7 },
  ],
  cycles: { grain: 3, drift: 1 },
};

export const PULSE: Preset = {
  schemaVersion: 1,
  id: 'pulse',
  name: 'Pulse',
  description:
    'The most visible of the set: onsets lift the glow while the frame breathes. Best choice when motion needs to read clearly.',
  routes: [
    { source: 'flux', target: 'glow.amount', base: 0.15, drive: 1.2, smooth: 0.3 },
    { source: 'rms', target: 'breathe.amount', base: 0.3, drive: 0.6, smooth: 0.5 },
    { source: 'centroid', target: 'vignette.amount', base: 0.1, drive: 0.3, smooth: 0.6 },
  ],
  cycles: { glow: 1, breathe: 2, vignette: 1 },
};

export const BUILTIN_PRESETS: readonly Preset[] = [STILL_WATER, EMBER, TIDE, DUST, PULSE];

export const DEFAULT_PRESET_ID = STILL_WATER.id;

export function findPreset(id: string): Preset | undefined {
  return BUILTIN_PRESETS.find((preset) => preset.id === id);
}
