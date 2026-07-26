import type { FeatureName, Preset, Route } from '../types';
import { EFFECT_IDS, FEATURE_NAMES } from '../types';
import { AMOUNT_PARAM, parseParamPath } from './routing';

/**
 * Preset validation.
 *
 * Presets are shareable JSON, so this is a trust boundary: anything parsed here
 * may have been hand-edited or come from another user. Errors name the exact
 * field at fault, because the failure a person sees is the whole value of
 * validating in the first place.
 */

export const PRESET_SCHEMA_VERSION = 1;

export class PresetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PresetError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new PresetError(`${field} must be a non-empty string`);
  }
  return value;
}

function requireFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new PresetError(`${field} must be a finite number, got ${JSON.stringify(value)}`);
  }
  return value;
}

function requireInRange(value: number, field: string, min: number, max: number): number {
  if (value < min || value > max) {
    throw new PresetError(`${field} must be within ${min}..${max}, got ${value}`);
  }
  return value;
}

function isFeatureName(value: unknown): value is FeatureName {
  return typeof value === 'string' && (FEATURE_NAMES as readonly string[]).includes(value);
}

function parseRoute(value: unknown, index: number): Route {
  const field = `routes[${index}]`;
  if (!isRecord(value)) {
    throw new PresetError(`${field} must be an object`);
  }

  if (!isFeatureName(value.source)) {
    throw new PresetError(
      `${field}.source must be one of ${FEATURE_NAMES.join(', ')}, got ${JSON.stringify(value.source)}`,
    );
  }

  const target = requireString(value.target, `${field}.target`);
  const parsed = parseParamPath(target);
  if (!parsed) {
    throw new PresetError(
      `${field}.target must be "<effect>.<param>" with an effect from ${EFFECT_IDS.join(', ')}, got "${target}"`,
    );
  }
  if (parsed.param !== AMOUNT_PARAM) {
    throw new PresetError(
      `${field}.target names unknown parameter "${parsed.param}"; only "${AMOUNT_PARAM}" exists`,
    );
  }

  // Base is a strength, so it belongs in 0..1. Drive may be negative — an
  // inverse route (louder means calmer) is a legitimate thing to want.
  const base = requireInRange(requireFiniteNumber(value.base, `${field}.base`), `${field}.base`, 0, 1);
  const drive = requireInRange(
    requireFiniteNumber(value.drive, `${field}.drive`),
    `${field}.drive`,
    -4,
    4,
  );
  const smooth = requireInRange(
    requireFiniteNumber(value.smooth, `${field}.smooth`),
    `${field}.smooth`,
    0,
    1,
  );

  return { source: value.source, target: target as Route['target'], base, drive, smooth };
}

/** Validate unknown data as a preset, throwing `PresetError` with a specific reason. */
export function parsePreset(value: unknown): Preset {
  if (!isRecord(value)) {
    throw new PresetError('a preset must be an object');
  }

  if (value.schemaVersion !== PRESET_SCHEMA_VERSION) {
    throw new PresetError(
      `unsupported schemaVersion ${JSON.stringify(value.schemaVersion)}; this build reads version ${PRESET_SCHEMA_VERSION}`,
    );
  }

  const id = requireString(value.id, 'id');
  const name = requireString(value.name, 'name');
  const description = typeof value.description === 'string' ? value.description : '';

  if (!Array.isArray(value.routes)) {
    throw new PresetError('routes must be an array');
  }
  if (value.routes.length === 0) {
    throw new PresetError('a preset needs at least one route, or it produces no motion');
  }
  const routes = value.routes.map(parseRoute);

  const cycles: Record<string, number> = {};
  if (value.cycles !== undefined) {
    if (!isRecord(value.cycles)) {
      throw new PresetError('cycles must be an object mapping effect names to whole numbers');
    }
    for (const [effect, count] of Object.entries(value.cycles)) {
      if (!(EFFECT_IDS as readonly string[]).includes(effect)) {
        throw new PresetError(`cycles names unknown effect "${effect}"`);
      }
      const parsed = requireFiniteNumber(count, `cycles.${effect}`);
      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new PresetError(
          `cycles.${effect} must be a whole number of at least 1 (a fraction would break the loop seam), got ${parsed}`,
        );
      }
      cycles[effect] = parsed;
    }
  }

  return {
    schemaVersion: PRESET_SCHEMA_VERSION,
    id,
    name,
    description,
    routes,
    ...(Object.keys(cycles).length > 0 ? { cycles: cycles as Preset['cycles'] } : {}),
  };
}

/** Parse a preset from a JSON string, reporting syntax and schema errors alike. */
export function parsePresetJson(json: string): Preset {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (cause) {
    throw new PresetError(
      `that is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  return parsePreset(data);
}

/** Serialize a preset for sharing. Round-trips through `parsePresetJson`. */
export function serializePreset(preset: Preset): string {
  return JSON.stringify(preset, null, 2);
}
