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

out vec4 fragColor;

vec2 mapUv(vec2 frameUv, vec4 fit) {
  return (frameUv - fit.zw) / fit.xy;
}

bool insideTexture(vec2 uv) {
  return all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)));
}

void main() {
  // Backdrop: the same artwork, cropped to fill the frame, then dimmed.
  vec3 color = texture(u_cover, mapUv(v_frameUv, u_coverFit)).rgb * u_backdropDim;

  // Foreground: the artwork untouched, contained within the frame. The first
  // frame of an export must match the static cover exactly, so this path does
  // nothing to the pixels it samples.
  vec2 artUv = mapUv(v_frameUv, u_containFit);
  if (insideTexture(artUv)) {
    color = texture(u_cover, artUv).rgb;
  }

  fragColor = vec4(color, 1.0);
}
