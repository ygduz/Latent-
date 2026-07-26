import type { CoverImage, EffectAmounts, EffectCycles, EffectId, Normalized } from '../types';
import { EFFECT_IDS } from '../types';
import { NO_MOTION } from '../presets/routing';
import { aspectOf, fitTransform } from './stage';
import { createProgram, uniformLocation } from './glUtils';
import vertexSource from './shaders/cover.vert?raw';
import fragmentSource from './shaders/cover.frag?raw';

export class WebGLUnavailableError extends Error {
  constructor() {
    super('WebGL2 is not available in this browser');
    this.name = 'WebGLUnavailableError';
  }
}

/** How far the backdrop is darkened relative to the artwork (0 = black). */
const BACKDROP_DIM = 0.32;

/** Cycle counts to use when none are supplied. */
const DEFAULT_CYCLES: EffectCycles = Object.fromEntries(
  EFFECT_IDS.map((effect) => [effect, 1]),
) as EffectCycles;

/**
 * Everything needed to draw one frame of a loop.
 *
 * Rendering takes resolved values rather than a preset and a timeline: routing
 * and analysis stay on the CPU where they are testable, and the renderer stays a
 * pure function of the numbers it is handed. The same call that draws a preview
 * frame draws an export frame.
 */
export interface RenderFrame {
  /** Position within the loop, 0..1. */
  readonly phase: Normalized;
  readonly amounts: EffectAmounts;
  readonly cycles?: EffectCycles;
}

/** Phase 0 with no motion: exactly the untouched cover art. */
export const STATIC_FRAME: RenderFrame = { phase: 0, amounts: NO_MOTION };

/**
 * Draws the cover art into the 9:16 stage: the artwork contained at full
 * width, over a dimmed cover-fitted backdrop of the same image.
 *
 * This is the static base of every render. Effects will layer onto it in a
 * later step; nothing here is audio-aware yet.
 *
 * Lifecycle is explicit — `create`, then `setCover`/`resize` in any order, then
 * `render`, then `dispose`. It holds GPU resources, so `dispose` is not
 * optional (React StrictMode will mount, unmount and remount it in dev).
 */
export class CoverRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly uniforms: {
    readonly cover: WebGLUniformLocation;
    readonly containFit: WebGLUniformLocation;
    readonly coverFit: WebGLUniformLocation;
    readonly backdropDim: WebGLUniformLocation;
    readonly phase: WebGLUniformLocation;
    readonly amounts: Readonly<Record<EffectId, WebGLUniformLocation>>;
    readonly cycles: Readonly<Record<EffectId, WebGLUniformLocation>>;
  };

  private texture: WebGLTexture | null = null;
  private coverAspect: number | null = null;
  private width = 0;
  private height = 0;
  private disposed = false;

  private constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.program = createProgram(gl, vertexSource, fragmentSource);
    const byEffect = (suffix: string) =>
      Object.fromEntries(
        EFFECT_IDS.map((effect) => [
          effect,
          uniformLocation(gl, this.program, `u_${effect}${suffix}`),
        ]),
      ) as Record<EffectId, WebGLUniformLocation>;

    this.uniforms = {
      cover: uniformLocation(gl, this.program, 'u_cover'),
      containFit: uniformLocation(gl, this.program, 'u_containFit'),
      coverFit: uniformLocation(gl, this.program, 'u_coverFit'),
      backdropDim: uniformLocation(gl, this.program, 'u_backdropDim'),
      phase: uniformLocation(gl, this.program, 'u_phase'),
      amounts: byEffect(''),
      cycles: byEffect('Cycles'),
    };
  }

  /**
   * Accepts an `OffscreenCanvas` as well as a DOM canvas, so export can render
   * at full size without putting a 1080×1920 element on the page.
   */
  static create(canvas: HTMLCanvasElement | OffscreenCanvas): CoverRenderer {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      // Export reads pixels back after drawing, so the buffer must survive.
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    if (!gl) {
      throw new WebGLUnavailableError();
    }
    return new CoverRenderer(gl);
  }

  /** Upload new artwork, replacing any previous texture. */
  setCover(cover: CoverImage): void {
    this.assertUsable();
    const { gl } = this;

    this.deleteTexture();

    const texture = gl.createTexture();
    if (!texture) {
      throw new Error('could not allocate cover texture');
    }

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cover.bitmap);
    // Clamped + linear so non-power-of-two artwork needs no mipmaps, and so
    // the backdrop crop never wraps to the opposite edge.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.bindTexture(gl.TEXTURE_2D, null);

    this.texture = texture;
    this.coverAspect = aspectOf(cover.width, cover.height);
  }

  /** Set the drawing-buffer size in device pixels. */
  resize(width: number, height: number): void {
    this.assertUsable();
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    if (w === this.width && h === this.height) {
      return;
    }
    this.width = w;
    this.height = h;
    this.gl.canvas.width = w;
    this.gl.canvas.height = h;
  }

  /**
   * Draw one frame. Clears to black when there is no artwork yet.
   *
   * Called with no argument it draws the static cover, which is both the
   * no-audio preview and, by the envelope invariant in the fragment shader,
   * exactly what phase 0 of any loop looks like.
   */
  render(frame: RenderFrame = STATIC_FRAME): void {
    this.assertUsable();
    const { gl } = this;

    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (!this.texture || this.coverAspect === null || this.width === 0 || this.height === 0) {
      return;
    }

    const frameAspect = aspectOf(this.width, this.height);
    const contain = fitTransform(this.coverAspect, frameAspect, 'contain');
    const cover = fitTransform(this.coverAspect, frameAspect, 'cover');

    gl.useProgram(this.program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(this.uniforms.cover, 0);

    gl.uniform4f(
      this.uniforms.containFit,
      contain.scale[0],
      contain.scale[1],
      contain.offset[0],
      contain.offset[1],
    );
    gl.uniform4f(
      this.uniforms.coverFit,
      cover.scale[0],
      cover.scale[1],
      cover.offset[0],
      cover.offset[1],
    );
    gl.uniform1f(this.uniforms.backdropDim, BACKDROP_DIM);

    gl.uniform1f(this.uniforms.phase, frame.phase);
    const cycles = frame.cycles ?? DEFAULT_CYCLES;
    for (const effect of EFFECT_IDS) {
      gl.uniform1f(this.uniforms.amounts[effect], frame.amounts[effect]);
      gl.uniform1f(this.uniforms.cycles[effect], cycles[effect]);
    }

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.deleteTexture();
    this.gl.deleteProgram(this.program);
    this.disposed = true;
  }

  private deleteTexture(): void {
    if (this.texture) {
      this.gl.deleteTexture(this.texture);
      this.texture = null;
      this.coverAspect = null;
    }
  }

  private assertUsable(): void {
    if (this.disposed) {
      throw new Error('CoverRenderer has been disposed');
    }
  }
}
