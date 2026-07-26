/**
 * Latent engine — domain contracts.
 *
 * These types are the seams between the four subsystems. Everything flows one
 * direction, and each stage depends only on the type produced by the previous:
 *
 *   analysis  AudioBuffer            -> FeatureTimeline
 *   loop      FeatureTimeline + LoopSegment -> LoopedTimeline
 *   render    LoopedTimeline + Preset + frame -> pixels
 *   export    frames                 -> MP4 + ValidationReport
 *
 * No implementation lives here, and nothing here imports anything else.
 */

// --- Units -----------------------------------------------------------------

/** Seconds of wall-clock / track time. */
export type Seconds = number;

/** A value clamped to 0..1. Every audio feature and safety limit uses this. */
export type Normalized = number;

// --- Cover art -------------------------------------------------------------

/** The artist's cover art, decoded and ready to upload as a GL texture. */
export interface CoverImage {
  readonly bitmap: ImageBitmap;
  readonly width: number;
  readonly height: number;
}

/**
 * Something worth telling the artist about their artwork. Never fatal — the
 * art always renders; these only warn about quality the export can't recover.
 */
export interface CoverImageWarning {
  readonly code: 'low-resolution' | 'not-square';
  readonly message: string;
}

/** How a source image is fitted into the frame. See `render/stage.ts`. */
export type FitMode = 'contain' | 'cover';

/** Maps frame space to texture space: `textureUv = (frameUv - offset) / scale`. */
export interface FitTransform {
  readonly scale: readonly [number, number];
  readonly offset: readonly [number, number];
}

// --- Analysis --------------------------------------------------------------

/**
 * The routable audio features. This union is deliberately small: each entry is
 * something an artist can reason about ("the low end drives the glow"), and
 * each becomes a source in the routing matrix.
 */
export type FeatureName = 'rms' | 'lowBand' | 'midBand' | 'highBand' | 'centroid' | 'flux';

export const FEATURE_NAMES = [
  'rms',
  'lowBand',
  'midBand',
  'highBand',
  'centroid',
  'flux',
] as const satisfies readonly FeatureName[];

/**
 * Per-frame audio features, stored columnar (one Float32Array per feature)
 * rather than as an array of objects: the loop blend and the render loop both
 * walk single features across time, and this keeps that cache-friendly.
 *
 * Every channel has exactly `frameCount` entries, all Normalized.
 */
export interface FeatureTimeline {
  readonly fps: number;
  readonly frameCount: number;
  readonly channels: Readonly<Record<FeatureName, Float32Array>>;
}

/** A single frame's worth of features, read out of a timeline. */
export type FeatureSample = Readonly<Record<FeatureName, Normalized>>;

// --- Loop ------------------------------------------------------------------

/** The window of the track the artist chose to loop. */
export interface LoopSegment {
  readonly startSec: Seconds;
  readonly durationSec: Seconds;
}

/**
 * A timeline that is guaranteed seamless: its features have been blended so
 * that the value after the last frame equals the value at frame 0. Producing
 * one of these is the only supported way to reach the renderer.
 */
export interface LoopedTimeline extends FeatureTimeline {
  readonly seamless: true;
  readonly segment: LoopSegment;
}

// --- Effects & routing -----------------------------------------------------

export type EffectId = 'breathe' | 'drift' | 'glow' | 'grain' | 'ripple' | 'vignette';

export const EFFECT_IDS = [
  'breathe',
  'drift',
  'glow',
  'grain',
  'ripple',
  'vignette',
] as const satisfies readonly EffectId[];

/** e.g. `'glow.amount'` — addresses one animatable parameter of one effect. */
export type EffectParamPath = `${EffectId}.${string}`;

/** Resolved 0..1 strength for every effect at one frame. */
export type EffectAmounts = Readonly<Record<EffectId, Normalized>>;

/**
 * How many times an effect's autonomous motion repeats within one loop.
 *
 * Integer by necessity, not by preference: motion is a function of loop phase,
 * so a whole number of cycles is what keeps the last frame identical to the
 * first. A fractional value would put a visible jump in the seam.
 */
export type EffectCycles = Readonly<Record<EffectId, number>>;

/**
 * One row of the routing matrix: a feature drives a parameter.
 *
 *   value(frame) = clamp(base + drive * feature(frame))
 *
 * Milestone 1 exposes these only through preset macro sliders; the Pro routing
 * matrix UI edits this same structure, so no engine rework is needed later.
 */
export interface Route {
  readonly source: FeatureName;
  readonly target: EffectParamPath;
  /** Parameter value when the track is silent. */
  readonly base: number;
  /** How far the feature is allowed to move the parameter. */
  readonly drive: number;
  /** Extra per-route smoothing on top of the engine-wide safety limits. */
  readonly smooth: Normalized;
}

/**
 * A named set of routes plus the cycle counts for their autonomous motion.
 *
 * Which effects are active is derived from `routes` rather than listed
 * separately, so there is one source of truth and no way for the two to
 * disagree.
 */
export interface Preset {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly routes: readonly Route[];
  /** Defaults to one cycle per loop for any effect not named here. */
  readonly cycles?: Partial<EffectCycles>;
}

// --- Motion safety ---------------------------------------------------------

/**
 * The "no-strobe guaranteed" promise, enforced structurally. These caps are
 * applied in the analysis stage, before any effect sees a value, so no preset
 * or slider combination can produce a strobing render.
 */
export interface SafetyLimits {
  /** Largest change any feature may make in one frame. */
  readonly maxDeltaPerFrame: Normalized;
  /** Ceiling on any feature's value. */
  readonly maxAmplitude: Normalized;
}

// --- Export & validation ---------------------------------------------------

export interface ExportSpec {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  /** Video bitrate in bits per second. */
  readonly bitrate: number;
}

export type CheckStatus = 'pass' | 'fail' | 'skipped';

export interface ValidationCheck {
  readonly id: string;
  readonly label: string;
  readonly status: CheckStatus;
  readonly detail?: string;
}

/**
 * The validator report is a user-facing feature, not just an internal
 * assertion: it is the thing that promises "this upload will not be rejected".
 */
export interface ValidationReport {
  readonly target: 'spotify-canvas';
  readonly checks: readonly ValidationCheck[];
  readonly ok: boolean;
}
