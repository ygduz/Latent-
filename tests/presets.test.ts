import { describe, expect, it } from 'vitest';
import {
  AMOUNT_PARAM,
  NO_MOTION,
  activeEffects,
  evaluateRoute,
  isEffectId,
  parseParamPath,
  resolveAmounts,
  resolveCycles,
} from '../src/engine/presets/routing';
import {
  PRESET_SCHEMA_VERSION,
  PresetError,
  parsePreset,
  parsePresetJson,
  serializePreset,
} from '../src/engine/presets/schema';
import { BUILTIN_PRESETS, findPreset } from '../src/engine/presets/builtins';
import { EFFECT_IDS, FEATURE_NAMES } from '../src/engine/types';
import type { FeatureName, FeatureSample, Preset, Route } from '../src/engine/types';

const sampleWith = (overrides: Partial<Record<FeatureName, number>> = {}): FeatureSample =>
  Object.fromEntries(
    FEATURE_NAMES.map((name) => [name, overrides[name] ?? 0]),
  ) as FeatureSample;

const presetWith = (routes: readonly Route[], cycles?: Preset['cycles']): Preset => ({
  schemaVersion: 1,
  id: 'test',
  name: 'Test',
  description: '',
  routes,
  ...(cycles ? { cycles } : {}),
});

describe('parseParamPath', () => {
  it('splits a valid path', () => {
    expect(parseParamPath('glow.amount')).toEqual({ effect: 'glow', param: 'amount' });
  });

  it('rejects malformed and unknown paths', () => {
    for (const path of ['', 'glow', '.amount', 'glow.', 'nosuch.amount', 'GLOW.amount']) {
      expect(parseParamPath(path), path).toBeNull();
    }
  });
});

describe('isEffectId', () => {
  it('accepts every declared effect and nothing else', () => {
    for (const effect of EFFECT_IDS) {
      expect(isEffectId(effect)).toBe(true);
    }
    expect(isEffectId('sparkle')).toBe(false);
  });
});

describe('evaluateRoute', () => {
  const route: Route = { source: 'rms', target: 'glow.amount', base: 0.2, drive: 0.5, smooth: 0 };

  it('is the base with no audio', () => {
    expect(evaluateRoute(route, sampleWith())).toBeCloseTo(0.2, 6);
  });

  it('adds drive times the feature', () => {
    expect(evaluateRoute(route, sampleWith({ rms: 1 }))).toBeCloseTo(0.7, 6);
    expect(evaluateRoute(route, sampleWith({ rms: 0.5 }))).toBeCloseTo(0.45, 6);
  });

  it('clamps into 0..1', () => {
    const eager = { ...route, base: 0.9, drive: 2 };
    expect(evaluateRoute(eager, sampleWith({ rms: 1 }))).toBe(1);

    const inverse = { ...route, base: 0.1, drive: -1 };
    expect(evaluateRoute(inverse, sampleWith({ rms: 1 }))).toBe(0);
  });

  it('supports an inverse route: louder means calmer', () => {
    const inverse: Route = { ...route, base: 1, drive: -1 };
    expect(evaluateRoute(inverse, sampleWith({ rms: 0 }))).toBe(1);
    expect(evaluateRoute(inverse, sampleWith({ rms: 1 }))).toBe(0);
  });

  it('reads only its own source feature', () => {
    expect(evaluateRoute(route, sampleWith({ highBand: 1 }))).toBeCloseTo(0.2, 6);
  });
});

describe('resolveAmounts', () => {
  it('leaves untargeted effects at zero', () => {
    const amounts = resolveAmounts(
      presetWith([{ source: 'rms', target: 'glow.amount', base: 0.5, drive: 0, smooth: 0 }]),
      sampleWith(),
    );
    expect(amounts.glow).toBeCloseTo(0.5, 6);
    for (const effect of EFFECT_IDS.filter((id) => id !== 'glow')) {
      expect(amounts[effect], effect).toBe(0);
    }
  });

  it('adds routes that target the same parameter, then clamps', () => {
    const amounts = resolveAmounts(
      presetWith([
        { source: 'rms', target: 'glow.amount', base: 0.4, drive: 0, smooth: 0 },
        { source: 'lowBand', target: 'glow.amount', base: 0.3, drive: 0, smooth: 0 },
      ]),
      sampleWith(),
    );
    expect(amounts.glow).toBeCloseTo(0.7, 6);
  });

  it('never exceeds 1 however many routes stack', () => {
    const amounts = resolveAmounts(
      presetWith(
        Array.from({ length: 5 }, () => ({
          source: 'rms' as FeatureName,
          target: 'glow.amount' as Route['target'],
          base: 0.5,
          drive: 0,
          smooth: 0,
        })),
      ),
      sampleWith(),
    );
    expect(amounts.glow).toBe(1);
  });

  it('ignores routes pointing at parameters it does not know', () => {
    // Presets are user-editable JSON, so one written by a newer build should
    // degrade rather than throw.
    const amounts = resolveAmounts(
      presetWith([
        { source: 'rms', target: 'glow.wobble' as Route['target'], base: 1, drive: 0, smooth: 0 },
        { source: 'rms', target: 'sparkle.amount' as Route['target'], base: 1, drive: 0, smooth: 0 },
      ]),
      sampleWith({ rms: 1 }),
    );
    for (const effect of EFFECT_IDS) {
      expect(amounts[effect], effect).toBe(0);
    }
  });

  it('covers every declared effect in its result', () => {
    const amounts = resolveAmounts(presetWith([]), sampleWith());
    expect(Object.keys(amounts).sort()).toEqual([...EFFECT_IDS].sort());
  });
});

describe('resolveCycles', () => {
  it('defaults to one cycle per loop', () => {
    const cycles = resolveCycles(presetWith([]));
    for (const effect of EFFECT_IDS) {
      expect(cycles[effect], effect).toBe(1);
    }
  });

  it('uses the preset value where given', () => {
    expect(resolveCycles(presetWith([], { glow: 3 })).glow).toBe(3);
  });

  it('forces whole numbers, since the loop seam depends on it', () => {
    expect(resolveCycles(presetWith([], { glow: 2.4 })).glow).toBe(2);
    expect(resolveCycles(presetWith([], { glow: 2.6 })).glow).toBe(3);
  });

  it('never drops below one cycle', () => {
    expect(resolveCycles(presetWith([], { glow: 0 })).glow).toBe(1);
    expect(resolveCycles(presetWith([], { glow: -5 })).glow).toBe(1);
  });
});

describe('activeEffects', () => {
  it('lists effects a preset can actually move', () => {
    const preset = presetWith([
      { source: 'rms', target: 'glow.amount', base: 0.2, drive: 0, smooth: 0 },
      { source: 'flux', target: 'drift.amount', base: 0, drive: 0.5, smooth: 0 },
      { source: 'rms', target: 'grain.amount', base: 0, drive: 0, smooth: 0 },
    ]);
    // Glow has a base, drift has drive; grain can never rise above zero.
    expect(activeEffects(preset)).toEqual(['drift', 'glow']);
  });

  it('returns them in a stable order regardless of route order', () => {
    const routes: Route[] = [
      { source: 'rms', target: 'vignette.amount', base: 0.5, drive: 0, smooth: 0 },
      { source: 'rms', target: 'breathe.amount', base: 0.5, drive: 0, smooth: 0 },
    ];
    expect(activeEffects(presetWith(routes))).toEqual(['breathe', 'vignette']);
    expect(activeEffects(presetWith([...routes].reverse()))).toEqual(['breathe', 'vignette']);
  });
});

describe('NO_MOTION', () => {
  it('is every effect at zero', () => {
    for (const effect of EFFECT_IDS) {
      expect(NO_MOTION[effect], effect).toBe(0);
    }
  });
});

describe('parsePreset', () => {
  const valid = {
    schemaVersion: 1,
    id: 'x',
    name: 'X',
    description: 'a preset',
    routes: [{ source: 'rms', target: 'glow.amount', base: 0.2, drive: 0.5, smooth: 0.3 }],
    cycles: { glow: 2 },
  };

  it('accepts a well-formed preset', () => {
    const preset = parsePreset(valid);
    expect(preset.id).toBe('x');
    expect(preset.routes).toHaveLength(1);
    expect(preset.cycles?.glow).toBe(2);
  });

  it('defaults a missing description rather than failing', () => {
    const { description: _unused, ...withoutDescription } = valid;
    expect(parsePreset(withoutDescription).description).toBe('');
  });

  it('omits cycles entirely when none are given', () => {
    const { cycles: _unused, ...withoutCycles } = valid;
    expect(parsePreset(withoutCycles).cycles).toBeUndefined();
  });

  it.each([
    ['not an object', 'a preset must be an object'],
    [{ ...valid, schemaVersion: 2 }, 'unsupported schemaVersion'],
    [{ ...valid, schemaVersion: undefined }, 'unsupported schemaVersion'],
    [{ ...valid, id: '' }, 'id must be a non-empty string'],
    [{ ...valid, name: 42 }, 'name must be a non-empty string'],
    [{ ...valid, routes: 'lots' }, 'routes must be an array'],
    [{ ...valid, routes: [] }, 'at least one route'],
    [{ ...valid, routes: ['nope'] }, 'routes[0] must be an object'],
    [{ ...valid, routes: [{ ...valid.routes[0], source: 'loudness' }] }, 'routes[0].source'],
    [{ ...valid, routes: [{ ...valid.routes[0], target: 'glow' }] }, 'routes[0].target'],
    [{ ...valid, routes: [{ ...valid.routes[0], target: 'glow.wobble' }] }, 'unknown parameter'],
    [{ ...valid, routes: [{ ...valid.routes[0], base: 2 }] }, 'routes[0].base must be within 0..1'],
    [{ ...valid, routes: [{ ...valid.routes[0], base: 'loud' }] }, 'routes[0].base must be a finite'],
    [{ ...valid, routes: [{ ...valid.routes[0], drive: 99 }] }, 'routes[0].drive'],
    [{ ...valid, routes: [{ ...valid.routes[0], smooth: -1 }] }, 'routes[0].smooth'],
    [{ ...valid, routes: [{ ...valid.routes[0], base: Number.NaN }] }, 'must be a finite number'],
    [{ ...valid, cycles: [] }, 'cycles must be an object'],
    [{ ...valid, cycles: { sparkle: 1 } }, 'unknown effect'],
    [{ ...valid, cycles: { glow: 1.5 } }, 'whole number'],
    [{ ...valid, cycles: { glow: 0 } }, 'whole number'],
  ])('rejects %# with a specific reason', (input, expected) => {
    expect(() => parsePreset(input)).toThrow(PresetError);
    expect(() => parsePreset(input)).toThrow(expected as string);
  });
});

describe('parsePresetJson and serializePreset', () => {
  it('round-trips every built-in preset unchanged', () => {
    for (const preset of BUILTIN_PRESETS) {
      expect(parsePresetJson(serializePreset(preset))).toEqual(preset);
    }
  });

  it('reports a syntax error distinctly from a schema error', () => {
    expect(() => parsePresetJson('{ nope')).toThrow(/not valid JSON/);
    expect(() => parsePresetJson('{"schemaVersion":9}')).toThrow(/unsupported schemaVersion/);
  });
});

describe('built-in presets', () => {
  it('are all valid against the schema', () => {
    for (const preset of BUILTIN_PRESETS) {
      expect(() => parsePreset(preset), preset.id).not.toThrow();
      expect(preset.schemaVersion).toBe(PRESET_SCHEMA_VERSION);
    }
  });

  it('have unique ids and findable by id', () => {
    const ids = BUILTIN_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(findPreset(id)?.id).toBe(id);
    }
  });

  it('all produce visible motion at full input', () => {
    const loud = sampleWith(
      Object.fromEntries(FEATURE_NAMES.map((name) => [name, 0.85])) as Partial<
        Record<FeatureName, number>
      >,
    );
    for (const preset of BUILTIN_PRESETS) {
      const amounts = resolveAmounts(preset, loud);
      const total = EFFECT_IDS.reduce((sum, effect) => sum + amounts[effect], 0);
      expect(total, `${preset.id} produces no motion`).toBeGreaterThan(0.2);
    }
  });

  it('stay calm: no preset saturates every effect at once', () => {
    const loud = sampleWith(
      Object.fromEntries(FEATURE_NAMES.map((name) => [name, 0.85])) as Partial<
        Record<FeatureName, number>
      >,
    );
    for (const preset of BUILTIN_PRESETS) {
      const amounts = resolveAmounts(preset, loud);
      const saturated = EFFECT_IDS.filter((effect) => amounts[effect] >= 1).length;
      expect(saturated, `${preset.id} saturates ${saturated} effects`).toBeLessThanOrEqual(1);
    }
  });

  it('only route to the one parameter that exists', () => {
    for (const preset of BUILTIN_PRESETS) {
      for (const route of preset.routes) {
        expect(parseParamPath(route.target)?.param, route.target).toBe(AMOUNT_PARAM);
      }
    }
  });
});
