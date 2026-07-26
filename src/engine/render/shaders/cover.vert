#version 300 es

// Fullscreen quad with no vertex buffer: the four corners are derived from
// gl_VertexID and drawn as a triangle strip.
out vec2 v_frameUv;

const vec2 CORNERS[4] = vec2[4](
  vec2(-1.0, -1.0),
  vec2( 1.0, -1.0),
  vec2(-1.0,  1.0),
  vec2( 1.0,  1.0)
);

void main() {
  vec2 clip = CORNERS[gl_VertexID];

  // Frame space is 0..1 with the origin at the TOP left, so it lines up with
  // image rows as uploaded (no UNPACK_FLIP_Y_WEBGL needed). Hence the y flip.
  v_frameUv = vec2(clip.x * 0.5 + 0.5, 0.5 - clip.y * 0.5);

  gl_Position = vec4(clip, 0.0, 1.0);
}
