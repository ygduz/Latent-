#version 300 es
precision highp float;

in vec2 v_frameUv;

uniform sampler2D u_cover;

// Each fit is packed as (scale.x, scale.y, offset.x, offset.y).
// See render/stage.ts — this is the same mapping, on the GPU.
uniform vec4 u_containFit;
uniform vec4 u_coverFit;

// How much the backdrop is darkened so it never competes with the art.
uniform float u_backdropDim;

// Position within the loop, 0..1.
uniform float u_phase;

// Effect strengths, 0..1, resolved from the preset's routes by the CPU.
uniform float u_breathe;
uniform float u_drift;
uniform float u_glow;
uniform float u_grain;
uniform float u_ripple;
uniform float u_vignette;

// Whole cycles per loop for each effect's autonomous motion.
uniform float u_breatheCycles;
uniform float u_driftCycles;
uniform float u_glowCycles;
uniform float u_grainCycles;
uniform float u_rippleCycles;
uniform float u_vignetteCycles;

out vec4 fragColor;

const float TAU = 6.283185307179586;

// Peak magnitudes at full strength, as a fraction of the artwork. Small by
// intent: these are the numbers that keep the result inside Apple's ban on
// frenetic motion, and they are the difference between calm and cheap.
const float MAX_ZOOM = 0.06;
const float MAX_DRIFT = 0.02;
const float MAX_RIPPLE = 0.004;
const float RIPPLE_FREQUENCY = 12.0;
const float GRAIN_STEPS_PER_LOOP = 24.0;
const int GLOW_TAPS = 12;

vec2 mapUv(vec2 frameUv, vec4 fit) {
  return (frameUv - fit.zw) / fit.xy;
}

bool insideTexture(vec2 uv) {
  return all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)));
}

/**
 * The envelope every effect is multiplied by.
 *
 * Rises from 0 and returns to 0, reaching exactly zero at phase 0 and phase 1.
 * That single property does two jobs: the first frame of a render is the
 * untouched cover art, which is what Apple Motion Art requires, and the frame
 * after the last is identical to the first, which is what makes the loop seam
 * invisible. No effect may bypass it.
 */
float envelope(float phase, float cycles) {
  return 0.5 - 0.5 * cos(TAU * phase * max(1.0, cycles));
}

/** A closed path that passes through the origin at phase 0. */
vec2 driftPath(float phase, float cycles) {
  float angle = TAU * phase * max(1.0, cycles);
  return vec2(sin(angle), sin(2.0 * angle) * 0.5);
}

/**
 * Smallest zoom that keeps the sampled region inside the artwork.
 *
 * Displacing the sample point by `reach` would otherwise read past the edge of
 * the texture and expose a stretched border. Zooming in by this much first
 * means motion always has somewhere to go.
 */
float zoomCoveringReach(float reach) {
  return 1.0 / max(1e-3, 1.0 - 2.0 * reach);
}

float hash(vec3 position) {
  return fract(sin(dot(position, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
}

/**
 * Cheap bloom: a ring of taps, keeping only what is already bright.
 *
 * A true bloom would downsample and blur across several passes. At the
 * strengths these presets use the difference is not visible, and this keeps the
 * whole renderer to one pass with no framebuffers.
 */
vec3 glowAt(vec2 uv, float radius) {
  vec3 total = vec3(0.0);
  for (int tap = 0; tap < GLOW_TAPS; tap += 1) {
    float angle = TAU * float(tap) / float(GLOW_TAPS);
    vec2 offset = vec2(cos(angle), sin(angle)) * radius;
    vec3 sampled = texture(u_cover, clamp(uv + offset, 0.0, 1.0)).rgb;
    float luminance = dot(sampled, vec3(0.2126, 0.7152, 0.0722));
    total += sampled * smoothstep(0.45, 1.0, luminance);
  }
  return total / float(GLOW_TAPS);
}

void main() {
  // Strengths for this frame: routed amount times the loop envelope.
  float breathe = u_breathe * envelope(u_phase, u_breatheCycles);
  float drift = u_drift * envelope(u_phase, u_driftCycles);
  float glow = u_glow * envelope(u_phase, u_glowCycles);
  float grain = u_grain * envelope(u_phase, u_grainCycles);
  float ripple = u_ripple * envelope(u_phase, u_rippleCycles);
  float vignette = u_vignette * envelope(u_phase, u_vignetteCycles);

  vec2 driftOffset = driftPath(u_phase, u_driftCycles) * (drift * MAX_DRIFT);
  float rippleAmplitude = ripple * MAX_RIPPLE;

  // Zoom enough to cover everything that displaces the sample point, and never
  // less than 1 — zooming out would expose the artwork's edges.
  float reach = max(abs(driftOffset.x), abs(driftOffset.y)) + rippleAmplitude;
  float zoom = max(1.0 + breathe * MAX_ZOOM, zoomCoveringReach(reach));

  vec2 artRect = mapUv(v_frameUv, u_containFit);

  vec2 rippleOffset = vec2(
    sin(artRect.y * RIPPLE_FREQUENCY + TAU * u_phase * max(1.0, u_rippleCycles)),
    cos(artRect.x * RIPPLE_FREQUENCY + TAU * u_phase * max(1.0, u_rippleCycles))
  ) * rippleAmplitude;

  // Motion happens inside the artwork's rectangle; the rectangle itself never
  // moves, so the Canvas layout stays put.
  vec2 artUv = (artRect - 0.5) / zoom + 0.5 + driftOffset + rippleOffset;

  // Backdrop: the same artwork cropped to fill the frame, dimmed, and moved at
  // half rate so it reads as depth rather than as a second copy.
  vec2 backdropUv = mapUv(v_frameUv, u_coverFit);
  backdropUv = clamp((backdropUv - 0.5) / zoom + 0.5 + driftOffset * 0.5, 0.0, 1.0);
  vec3 color = texture(u_cover, backdropUv).rgb * u_backdropDim;

  if (insideTexture(artRect)) {
    color = texture(u_cover, clamp(artUv, 0.0, 1.0)).rgb;
  }

  if (glow > 0.0) {
    color += glowAt(insideTexture(artRect) ? artUv : backdropUv, 0.012 + glow * 0.02) * glow * 0.6;
  }

  if (grain > 0.0) {
    // A whole number of grain fields per loop, so the cycle closes exactly.
    float step = floor(u_phase * GRAIN_STEPS_PER_LOOP * max(1.0, u_grainCycles));
    float noise = hash(vec3(v_frameUv * 512.0, step)) - 0.5;
    color += noise * grain * 0.09;
  }

  if (vignette > 0.0) {
    float distanceFromCentre = distance(v_frameUv, vec2(0.5));
    color *= 1.0 - vignette * 0.55 * smoothstep(0.3, 0.95, distanceFromCentre);
  }

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
