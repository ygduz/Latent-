/**
 * Small WebGL2 helpers shared by every render pass.
 *
 * Kept deliberately thin — this is not a wrapper library. Its only job is to
 * turn GL's silent-failure model into loud, debuggable errors.
 */

export class ShaderCompileError extends Error {
  constructor(kind: 'vertex' | 'fragment', log: string) {
    super(`${kind} shader failed to compile:\n${log}`);
    this.name = 'ShaderCompileError';
  }
}

export class ProgramLinkError extends Error {
  constructor(log: string) {
    super(`shader program failed to link:\n${log}`);
    this.name = 'ProgramLinkError';
  }
}

function compileShader(
  gl: WebGL2RenderingContext,
  kind: 'vertex' | 'fragment',
  source: string,
): WebGLShader {
  const shader = gl.createShader(kind === 'vertex' ? gl.VERTEX_SHADER : gl.FRAGMENT_SHADER);
  if (!shader) {
    throw new Error(`could not allocate ${kind} shader`);
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? '(no log)';
    gl.deleteShader(shader);
    throw new ShaderCompileError(kind, log);
  }

  return shader;
}

/** Compile and link a program, then discard the intermediate shader objects. */
export function createProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram {
  const vertex = compileShader(gl, 'vertex', vertexSource);
  let fragment: WebGLShader;
  try {
    fragment = compileShader(gl, 'fragment', fragmentSource);
  } catch (error) {
    gl.deleteShader(vertex);
    throw error;
  }

  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    throw new Error('could not allocate shader program');
  }

  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);

  // Safe to delete once linked — the program keeps its own copy.
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? '(no log)';
    gl.deleteProgram(program);
    throw new ProgramLinkError(log);
  }

  return program;
}

/**
 * Look up a uniform, failing loudly if it is missing. GL returns null for
 * unknown *and* optimised-away uniforms, which otherwise silently no-ops every
 * later `uniform*` call and produces a black frame with no error.
 */
export function uniformLocation(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
): WebGLUniformLocation {
  const location = gl.getUniformLocation(program, name);
  if (location === null) {
    throw new Error(`uniform "${name}" not found (unused in the shader, or misspelled)`);
  }
  return location;
}
