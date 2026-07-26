import { useEffect, useRef, useState } from 'react';
import type { CoverImage } from '../../engine/types';
import type { RenderFrame } from '../../engine/render/coverRenderer';
import { CoverRenderer, WebGLUnavailableError } from '../../engine/render/coverRenderer';
import { CANVAS_EXPORT_DEFAULT } from '../../engine/export/spec';

interface PreviewStageProps {
  readonly cover: CoverImage | null;
  /**
   * Supplies the frame to draw. Called once per animation frame while
   * `animating`, and once whenever it changes otherwise.
   *
   * The stage deliberately knows nothing about audio, presets or timelines: it
   * draws what it is handed, which keeps every decision about *what* motion to
   * make on the engine side where it is testable.
   */
  readonly frameFor: (() => RenderFrame) | null;
  readonly animating: boolean;
}

/** Cap the backing buffer at the export size — more pixels than that are wasted. */
const MAX_BUFFER_WIDTH = CANVAS_EXPORT_DEFAULT.width;

/** The 9:16 stage. Owns the canvas element and the renderer's lifecycle. */
export function PreviewStage({ cover, frameFor, animating }: PreviewStageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<CoverRenderer | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Read by the effects below so they always see current values without having
  // to tear down and rebuild the renderer or the animation loop.
  const coverRef = useRef(cover);
  coverRef.current = cover;
  const frameForRef = useRef(frameFor);
  frameForRef.current = frameFor;

  // Create the renderer once per mounted canvas, and dispose it on unmount.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    let renderer: CoverRenderer;
    try {
      renderer = CoverRenderer.create(canvas);
    } catch (cause) {
      setError(
        cause instanceof WebGLUnavailableError
          ? 'This browser does not support WebGL2, which Latent needs to render.'
          : 'The renderer could not start.',
      );
      return;
    }

    rendererRef.current = renderer;
    setError(null);

    if (coverRef.current) {
      renderer.setCover(coverRef.current);
    }

    // Track the element's CSS size and keep the drawing buffer in step.
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      const { width } = entry.contentRect;
      if (width <= 0) {
        return;
      }
      const scale = Math.min(window.devicePixelRatio || 1, MAX_BUFFER_WIDTH / width);
      const bufferWidth = Math.round(width * scale);
      const aspect = CANVAS_EXPORT_DEFAULT.width / CANVAS_EXPORT_DEFAULT.height;
      renderer.resize(bufferWidth, Math.round(bufferWidth / aspect));
      renderer.render(frameForRef.current?.());
    });
    observer.observe(canvas);

    return () => {
      observer.disconnect();
      rendererRef.current = null;
      renderer.dispose();
    };
  }, []);

  // Upload artwork whenever it changes.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !cover) {
      return;
    }
    renderer.setCover(cover);
    renderer.render(frameForRef.current?.());
  }, [cover]);

  // Animate while playing; otherwise draw a single frame and stop.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) {
      return;
    }

    if (!animating) {
      renderer.render(frameFor?.());
      return;
    }

    let handle = 0;
    const tick = () => {
      renderer.render(frameForRef.current?.());
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [animating, frameFor]);

  return (
    <div className="stage">
      <canvas ref={canvasRef} className="stage-canvas" data-testid="stage-canvas" />
      {error ? <p className="stage-error">{error}</p> : null}
      {!error && !cover ? <p className="stage-empty">9:16 preview</p> : null}
    </div>
  );
}
