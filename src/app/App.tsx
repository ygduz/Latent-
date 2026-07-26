import { CANVAS_EXPORT_DEFAULT, CANVAS_SPEC } from '../engine/export/spec';

/**
 * Placeholder shell. The app layer owns UI and state only — all behaviour
 * lives in `src/engine`, which this imports from. Dependencies point one way:
 * app -> engine, never the reverse (enforced in eslint.config.js).
 */
export function App() {
  const { width, height, fps } = CANVAS_EXPORT_DEFAULT;

  return (
    <main className="shell">
      <header>
        <h1>Latent</h1>
        <p className="tagline">
          Your cover art, moved by your music. Rendered on your device — nothing is uploaded.
        </p>
      </header>

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

      <p className="status">Scaffold only — intake, analysis and render land next.</p>
    </main>
  );
}
