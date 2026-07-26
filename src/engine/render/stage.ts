import type { FitMode, FitTransform } from '../types';

/**
 * Stage fit math.
 *
 * The Canvas frame is 9:16 but cover art is almost always square, so the art
 * can never simply fill the frame. Two fits are computed from the same source:
 * the art is *contained* (full width, letterboxed) and a *cover* fit of the
 * same image is dimmed behind it as a backdrop. Both are expressed as a
 * transform from frame space into texture space, which is what the shader
 * needs and what makes this pure and testable without a GPU.
 *
 * Frame space and texture space are both 0..1 with the origin at the top left.
 * The shader maps one to the other as:
 *
 *   textureUv = (frameUv - offset) / scale
 *
 * `scale` is how much of the frame the source spans, so `contain` yields a
 * scale <= 1 (source sits inside the frame, with bars) and `cover` yields a
 * scale >= 1 on one axis (source overflows, so the texture is cropped).
 */
export function fitTransform(
  srcAspect: number,
  dstAspect: number,
  mode: FitMode,
): FitTransform {
  if (!(srcAspect > 0) || !Number.isFinite(srcAspect)) {
    throw new RangeError(`source aspect must be a positive number, got ${srcAspect}`);
  }
  if (!(dstAspect > 0) || !Number.isFinite(dstAspect)) {
    throw new RangeError(`destination aspect must be a positive number, got ${dstAspect}`);
  }

  // A source wider than the frame is width-limited when contained and
  // height-limited when covering; narrower sources are the other way round.
  const sourceIsWider = srcAspect >= dstAspect;
  const limitWidth = mode === 'contain' ? sourceIsWider : !sourceIsWider;

  const scaleX = limitWidth ? 1 : srcAspect / dstAspect;
  const scaleY = limitWidth ? dstAspect / srcAspect : 1;

  return {
    scale: [scaleX, scaleY],
    offset: [(1 - scaleX) / 2, (1 - scaleY) / 2],
  };
}

/** Aspect ratio (width / height) as the fit functions expect it. */
export function aspectOf(width: number, height: number): number {
  if (!(width > 0) || !(height > 0)) {
    throw new RangeError(`dimensions must be positive, got ${width}x${height}`);
  }
  return width / height;
}

/**
 * Apply a fit transform on the CPU — the exact operation the shader performs.
 * Used by tests to assert what a given frame position samples.
 */
export function sampleUv(frameUv: readonly [number, number], fit: FitTransform): [number, number] {
  return [
    (frameUv[0] - fit.offset[0]) / fit.scale[0],
    (frameUv[1] - fit.offset[1]) / fit.scale[1],
  ];
}
