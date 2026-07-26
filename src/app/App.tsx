import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CoverImage,
  CoverImageWarning,
  FeatureTimeline,
  LoopSegment,
  ValidationReport,
} from '../engine/types';
import type { RenderFrame } from '../engine/render/coverRenderer';
import { CoverImageError, loadCoverImage, validateCoverImage } from '../engine/intake/coverImage';
import { AudioDecodeError, decodeAudioFile } from '../engine/analysis/decode';
import { analyze } from '../engine/analysis/analyzer';
import { sampleFeatures } from '../engine/analysis/features';
import { WAVEFORM_BUCKETS, computePeaks } from '../engine/analysis/waveform';
import { clampSegment, defaultSegment, timelineFrameFor } from '../engine/loop';
import { LoopPlayer } from '../engine/playback/loopPlayer';
import { BUILTIN_PRESETS, DEFAULT_PRESET_ID, findPreset } from '../engine/presets/builtins';
import { resolveAmounts, resolveCycles } from '../engine/presets/routing';
import { CANVAS_EXPORT_DEFAULT, CANVAS_SPEC } from '../engine/export/spec';
import {
  ExportUnsupportedError,
  exportCanvasLoop,
  exportFilename,
  isExportSupported,
} from '../engine/export/encoder';
import { DropZone } from './components/DropZone';
import { PresetPicker } from './components/PresetPicker';
import { PreviewStage } from './components/PreviewStage';
import { SegmentPicker } from './components/SegmentPicker';
import { ValidatorReport } from './components/ValidatorReport';
import { formatSeconds } from './format';

interface FinishedExport {
  readonly url: string;
  readonly filename: string;
  readonly sizeBytes: number;
  readonly report: ValidationReport;
}

interface LoadedAudio {
  readonly name: string;
  readonly buffer: AudioBuffer;
  readonly timeline: FeatureTimeline;
  readonly peaks: Float32Array;
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
  const [segment, setSegment] = useState<LoopSegment | null>(null);
  const [presetId, setPresetId] = useState(DEFAULT_PRESET_ID);
  const [analysing, setAnalysing] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const [finished, setFinished] = useState<FinishedExport | null>(null);

  const playerRef = useRef<LoopPlayer | null>(null);
  const preset = findPreset(presetId) ?? BUILTIN_PRESETS[0]!;

  useEffect(() => () => playerRef.current?.dispose(), []);

  // Blob URLs are held by the browser until revoked, and an export is ~1 MB.
  const finishedUrl = finished?.url;
  useEffect(
    () => () => {
      if (finishedUrl) {
        URL.revokeObjectURL(finishedUrl);
      }
    },
    [finishedUrl],
  );

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
      const peaks = computePeaks(buffer, WAVEFORM_BUCKETS);
      const initialSegment = defaultSegment(buffer.duration);

      playerRef.current?.dispose();
      playerRef.current = new LoopPlayer(buffer, initialSegment);
      setPlaying(false);
      setSegment(initialSegment);
      setAudio({ name: file.name, buffer, timeline, peaks });
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

  const handleSegmentChange = useCallback(
    (next: LoopSegment) => {
      if (!audio) {
        return;
      }
      const settled = clampSegment(next, audio.buffer.duration);
      setSegment(settled);
      // Only reached on release, not mid-drag, so playback restarts once.
      playerRef.current?.setSegment(settled);
      // A finished file no longer describes what is on screen.
      setFinished(null);
    },
    [audio],
  );

  const handleExport = useCallback(async () => {
    if (!cover || !audio || !segment) {
      return;
    }
    // Rendering every frame competes with playback for the main thread.
    playerRef.current?.pause();
    setPlaying(false);
    setFinished(null);
    setError(null);
    setExportProgress(0);

    try {
      const result = await exportCanvasLoop({
        cover,
        timeline: audio.timeline,
        preset,
        segment,
        onProgress: setExportProgress,
      });
      setFinished({
        url: URL.createObjectURL(result.blob),
        filename: exportFilename(audio.name, preset),
        sizeBytes: result.blob.size,
        report: result.report,
      });
    } catch (cause) {
      setError(
        cause instanceof ExportUnsupportedError
          ? cause.message
          : `The export failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    } finally {
      setExportProgress(null);
    }
  }, [audio, cover, preset, segment]);

  // Cycle counts are fixed per preset, so resolve them once rather than per frame.
  const cycles = useMemo(() => resolveCycles(preset), [preset]);

  const frameFor = useMemo(() => {
    if (!audio || !segment) {
      return null;
    }
    const { timeline } = audio;
    return (): RenderFrame => {
      const phase = playerRef.current?.phase() ?? 0;
      const sample = sampleFeatures(timeline, timelineFrameFor(segment, phase, timeline.fps));
      return { phase, amounts: resolveAmounts(preset, sample), cycles };
    };
  }, [audio, segment, preset, cycles]);

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

          {audio && segment ? (
            <>
              <p className="notice notice-ok">
                {audio.name} — {formatSeconds(audio.buffer.duration)} analysed, looping{' '}
                {segment.durationSec.toFixed(1)}s from {formatSeconds(segment.startSec)}.
              </p>
              <button type="button" className="transport" onClick={() => void togglePlayback()}>
                {playing ? 'Pause' : 'Play loop'}
              </button>
              <SegmentPicker
                peaks={audio.peaks}
                trackDurationSec={audio.buffer.duration}
                segment={segment}
                onChange={handleSegmentChange}
              />
            </>
          ) : null}

          <PresetPicker
            presets={BUILTIN_PRESETS}
            selectedId={presetId}
            onSelect={(id) => {
              setPresetId(id);
              // The finished file was made with the previous preset.
              setFinished(null);
            }}
          />

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

            {cover && audio && segment ? (
              <div className="export">
                <button
                  type="button"
                  className="transport transport-primary"
                  disabled={exportProgress !== null || !isExportSupported()}
                  onClick={() => void handleExport()}
                >
                  {exportProgress === null
                    ? 'Export MP4'
                    : `Rendering ${Math.round(exportProgress * 100)}%`}
                </button>

                {exportProgress !== null ? (
                  <progress
                    className="export-progress"
                    max={1}
                    value={exportProgress}
                    aria-label="Export progress"
                  />
                ) : null}

                {!isExportSupported() ? (
                  <p className="notice notice-warn">
                    This browser cannot write an MP4 on its own. Try Chrome, Edge, or Safari 26 or
                    newer.
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="export-hint">Add artwork and a track to export.</p>
            )}
          </section>

          {finished ? (
            <>
              <ValidatorReport report={finished.report} />
              <a className="download" href={finished.url} download={finished.filename}>
                Download {finished.filename}
                <span>{(finished.sizeBytes / 1_000_000).toFixed(2)} MB</span>
              </a>
            </>
          ) : null}
        </div>
      </div>

      <p className="status">
        {audio
          ? 'Rendered on this device. Nothing about your track leaves the browser.'
          : 'Add artwork and a track to see the motion.'}
      </p>
    </main>
  );
}
