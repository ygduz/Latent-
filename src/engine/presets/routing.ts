import type {
  EffectAmounts,
  EffectCycles,
  EffectId,
  EffectParamPath,
  FeatureSample,
  Normalized,
  Preset,
  Route,
} from '../types';
import { EFFECT_IDS } from '../types';

/**
 * Routing: audio features in, effect strengths out.
 *
 * Pure and GPU-free, so the entire mapping from music to motion is testable
 * without rendering anything. The renderer only consumes the result.
 */

/**
 * The only routable parameter each effect currently exposes.
 *
 * Effects deliberately have a single strength rather than a spread of knobs:
 * the preset chooses the character, and audio chooses how much of it. More
 * parameters can be added to this registry without changing the route shape.
 */
export const AMOUNT_PARAM = 'amount';

export const ROUTABLE_PARAMS: readonly EffectParamPath[] = EFFECT_IDS.map(
  (effect) => `${effect}.${AMOUNT_PARAM}` as EffectParamPath,
);

/** Default cycles per loop when a preset does not say otherwise. */
export const DEFAULT_CYCLES = 1;

/** Split `'glow.amount'` into its effect and parameter, or return null. */
export function parseParamPath(
  path: string,
): { readonly effect: EffectId; readonly param: string } | null {
  const separator = path.indexOf('.');
  if (separator <= 0) {
    return null;
  }
  const effect = path.slice(0, separator);
  const param = path.slice(separator + 1);
  if (!isEffectId(effect) || param.length === 0) {
    return null;
  }
  return { effect, param };
}

export function isEffectId(value: string): value is EffectId {
  return (EFFECT_IDS as readonly string[]).includes(value);
}

const zeroAmounts = (): Record<EffectId, number> =>
  Object.fromEntries(EFFECT_IDS.map((effect) => [effect, 0])) as Record<EffectId, number>;

/**
 * Evaluate one route against a feature sample.
 *
 * `value = base + drive * feature`, clamped to 0..1. Base is the strength with
 * no audio at all, which is what makes a route with `drive: 0` a valid way to
 * express constant motion.
 */
export function evaluateRoute(route: Route, sample: FeatureSample): Normalized {
  const feature = sample[route.source] ?? 0;
  return Math.min(1, Math.max(0, route.base + route.drive * feature));
}

/**
 * Resolve every effect's strength for one frame.
 *
 * Routes targeting the same parameter add together before clamping, so layering
 * two features onto one effect behaves the way stacking usually does. Routes
 * pointing at unknown parameters are ignored rather than throwing — presets are
 * user-editable JSON, and a preset from a newer version should degrade rather
 * than fail.
 */
export function resolveAmounts(preset: Preset, sample: FeatureSample): EffectAmounts {
  const amounts = zeroAmounts();

  for (const route of preset.routes) {
    const parsed = parseParamPath(route.target);
    if (!parsed || parsed.param !== AMOUNT_PARAM) {
      continue;
    }
    amounts[parsed.effect] += evaluateRoute(route, sample);
  }

  for (const effect of EFFECT_IDS) {
    amounts[effect] = Math.min(1, Math.max(0, amounts[effect]));
  }

  return amounts;
}

/** Cycle counts for every effect, with defaults filled in and values made whole. */
export function resolveCycles(preset: Preset): EffectCycles {
  const cycles = {} as Record<EffectId, number>;
  for (const effect of EFFECT_IDS) {
    const requested = preset.cycles?.[effect] ?? DEFAULT_CYCLES;
    // Rounded to a whole number because the loop seam depends on it.
    cycles[effect] = Math.max(1, Math.round(requested));
  }
  return cycles;
}

/** Effects a preset actually drives — those with a route that can reach above zero. */
export function activeEffects(preset: Preset): readonly EffectId[] {
  const active = new Set<EffectId>();
  for (const route of preset.routes) {
    const parsed = parseParamPath(route.target);
    if (parsed && parsed.param === AMOUNT_PARAM && (route.base > 0 || route.drive !== 0)) {
      active.add(parsed.effect);
    }
  }
  return EFFECT_IDS.filter((effect) => active.has(effect));
}

/** Strengths with every effect off — the static cover. */
export const NO_MOTION: EffectAmounts = zeroAmounts();
