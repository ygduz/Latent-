import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CoverImage,
  CoverImageWarning,
  FeatureTimeline,
  LoopSegment,
} from '../engine/types';
import type { RenderFrame } from '../engine/render/coverRenderer';
import { CoverImageError, loadCoverImage, validateCoverImage } from '../engine/intake/coverImage';
import { AudioDecodeError, decodeAudioFile } from '../engine/analysis/decode';
import { analyze } from '../engine/analysis/analyzer';
import { sampleFeatures } from '../engine/analysis/features';
import { defaultSegment, timelineFrameFor } from '../engine/loop';
import { LoopPlayer } from '../engine/playback/loopPlayer';
import { BUILTIN_PRESETS, DEFAULT_PRESET_ID, findPreset } from '../engine/presets/builtins';
import { resolveAmounts, resolveCycles } from '../engine/presets/routing';
import { CANVAS_EXPORT_DEFAULT, CANVAS_SPEC } from '../engine/export/spec';
import { DropZone } from './components/DropZone';
import { PresetPicker } from './components/PresetPicker';
import { PreviewStage } from './components/PreviewStage';

interface LoadedAudio {
  readonly name: string;
  readonly buffer: AudioBuffer;
  readonly timeline: FeatureTimeline;
  readonly segment: LoopSegment;
}

/**
 * The app layer owns UI and state only — all behaviour lives in `src/engine`,
 * which this imports from. Dependencies point one way: app -> engine, never the
 * reverse (enforced in eslint.config.js).
 */
export function App() {
  const [cover, setCover] = useState<CoverImage | null>(null);
  const [warnings, setWarnings] = useState<readonly CoverImageWarning[]>([]);
  const [audio, setAudio] = useState<LoadedAudio | null>(null);
  const [presetId, setPresetId] = useState(DEFAULT_PRESET_ID);
  const [analysing, setAnalysing] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const playerRef = useRef<LoopPlayer | null>(null);
  const preset = findPreset(presetId) ?? BUILTIN_PRESETS[0]!;

  useEffect(() => () => playerRef.current?.dispose(), []);

  const handleCover = useCallback(async (file: File) => {
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
      setError(cause instanceof CoverImageError ? cause.message : 'That file could not be loaded.');
    }
  }, []);

  const handleAudio = useCallback(async (file: File) => {
    setAnalysing(true);
    setError(null);
    try {
      const buffer = await decodeAudioFile(file);
      // Yield once so the analysing state paints before the main thread is busy.
      // Analysis is synchronous today; moving it to a worker is the fix if long
      // tracks start to feel slow.
      await new Promise((resolve) => setTimeout(resolve, 0));

      const timeline = analyze(buffer, { fps: CANVAS_EXPORT_DEFAULT.fps });
      const segment = defaultSegment(buffer.duration);

      playerRef.current?.dispose();
      playerRef.current = new LoopPlayer(buffer, segment);
      setPlaying(false);
      setAudio({ name: file.name, buffer, timeline, segment });
    } catch (cause) {
      setError(
        cause instanceof AudioDecodeError ? cause.message : 'That audio could not be analysed.',
      );
    } finally {
      setAnalysing(false);
    }
  }, []);

  const togglePlayback = useCallback(async () => {
    const player = playerRef.current;
    if (!player) {
      return;
    }
    if (player.playing) {
      player.pause();
      setPlaying(false);
    } else {
      await player.play();
      setPlaying(true);
    }
  }, []);

  // Cycle counts are fixed per preset, so resolve them once rather than per frame.
  const cycles = useMemo(() => resolveCycles(preset), [preset]);

  const frameFor = useMemo(() => {
    if (!audio) {
      return null;
    }
    const { timeline, segment } = audio;
    return (): RenderFrame => {
      const phase = playerRef.current?.phase() ?? 0;
      const sample = sampleFeatures(timeline, timelineFrameFor(segment, phase, timeline.fps));
      return { phase, amounts: resolveAmounts(preset, sample), cycles };
    };
  }, [audio, preset, cycles]);

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
        <PreviewStage cover={cover} frameFor={frameFor} animating={playing} />

        <div className="panel">
          <DropZone
            onFile={handleCover}
            accept="image/*"
            title="Drop your cover art"
            hint="PNG, JPEG or WebP — square and at least 1080px"
          />

          <DropZone
            onFile={handleAudio}
            accept="audio/*"
            disabled={analysing}
            title="Drop your track"
            hint="WAV, MP3, FLAC or M4A — never uploaded, analysed on this device"
          />

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

          {analysing ? <p className="notice notice-ok">Analysing audio…</p> : null}

          {audio ? (
            <>
              <p className="notice notice-ok">
                {audio.name} — {audio.buffer.duration.toFixed(1)}s analysed, looping{' '}
                {audio.segment.durationSec.toFixed(1)}s from the start.
              </p>
              <button type="button" className="transport" onClick={() => void togglePlayback()}>
                {playing ? 'Pause' : 'Play loop'}
              </button>
            </>
          ) : null}

          <PresetPicker presets={BUILTIN_PRESETS} selectedId={presetId} onSelect={setPresetId} />

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
        {audio
          ? 'Preview only — the loop picker and MP4 export land next.'
          : 'Add artwork and a track to see the motion.'}
      </p>
    </main>
  );
}
