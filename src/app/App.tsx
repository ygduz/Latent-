import { useCallback, useState } from 'react';
import type { CoverImage, CoverImageWarning } from '../engine/types';
import { CoverImageError, loadCoverImage, validateCoverImage } from '../engine/intake/coverImage';
import { CANVAS_EXPORT_DEFAULT, CANVAS_SPEC } from '../engine/export/spec';
import { DropZone } from './components/DropZone';
import { PreviewStage } from './components/PreviewStage';

/**
 * The app layer owns UI and state only — all behaviour lives in `src/engine`,
 * which this imports from. Dependencies point one way: app -> engine, never the
 * reverse (enforced in eslint.config.js).
 */
export function App() {
  const [cover, setCover] = useState<CoverImage | null>(null);
  const [warnings, setWarnings] = useState<readonly CoverImageWarning[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(async (file: File) => {
    try {
      const next = await loadCoverImage(file);
      setWarnings(validateCoverImage(next.width, next.height));
      setError(null);
      setCover((previous) => {
        // Bitmaps hold decoded pixels outside the JS heap; release the old one.
        previous?.bitmap.close();
        return next;
      });
    } catch (cause) {
      setError(
        cause instanceof CoverImageError ? cause.message : 'That file could not be loaded.',
      );
    }
  }, []);

  const { width, height, fps } = CANVAS_EXPORT_DEFAULT;

  return (
    <main className="shell">
      <header>
        <h1>Latent</h1>
        <p className="tagline">
          Your cover art, moved by your music. Rendered on your device — nothing is uploaded.
        </p>
      </header>

      <div className="workspace">
        <PreviewStage cover={cover} />

        <div className="panel">
          <DropZone onFile={handleFile} />

          {error ? (
            <p className="notice notice-error" role="alert">
              {error}
            </p>
          ) : null}

          {warnings.map((warning) => (
            <p key={warning.code} className="notice notice-warn">
              {warning.message}
            </p>
          ))}

          {cover ? (
            <p className="notice notice-ok">
              Loaded {cover.width}×{cover.height} artwork.
            </p>
          ) : null}

          <section className="target" aria-label="Export target">
            <h2>Export target</h2>
            <dl>
              <div>
                <dt>Format</dt>
                <dd>
                  {width}×{height} · {fps} fps · {CANVAS_SPEC.container.toUpperCase()} /{' '}
                  {CANVAS_SPEC.videoCodec.toUpperCase()}
                </dd>
              </div>
              <div>
                <dt>Loop length</dt>
                <dd>
                  {CANVAS_SPEC.minDurationSec}–{CANVAS_SPEC.maxDurationSec} seconds, seamless
                </dd>
              </div>
              <div>
                <dt>Audio track</dt>
                <dd>{CANVAS_SPEC.allowsAudio ? 'Included' : 'Stripped (per Canvas spec)'}</dd>
              </div>
            </dl>
          </section>
        </div>
      </div>

      <p className="status">
        Static render only — audio analysis, motion and export land next.
      </p>
    </main>
  );
}
