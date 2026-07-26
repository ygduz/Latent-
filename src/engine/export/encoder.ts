import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import type {
  CoverImage,
  ExportSpec,
  FeatureTimeline,
  LoopSegment,
  Preset,
  ValidationReport,
} from '../types';
import { frameCountForLoop, timelineFrameFor } from '../loop';
import { sampleFeatures } from '../analysis/features';
import { resolveAmounts, resolveCycles } from '../presets/routing';
import { CoverRenderer, STATIC_FRAME } from '../render/coverRenderer';
import { CANVAS_EXPORT_DEFAULT } from './spec';
import type { ExportMeasurements } from './validator';
import { validateCanvasExport } from './validator';

/**
 * Frame-by-frame MP4 export.
 *
 * Every frame is rendered from its own index — never from a clock — so the same
 * inputs always produce the same file. This is what lets Latent promise a
 * deterministic result, and it is why export cannot reuse the preview's
 * audio-driven timing.
 *
 * All of it runs on the device: no upload, no queue, and no per-render cost.
 */

export class ExportUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportUnsupportedError';
  }
}

export interface ExportOptions {
  readonly cover: CoverImage;
  readonly timeline: FeatureTimeline;
  readonly preset: Preset;
  readonly segment: LoopSegment;
  readonly spec?: ExportSpec;
  /** Called with 0..1 as frames are encoded. */
  readonly onProgress?: (fraction: number) => void;
}

export interface ExportResult {
  readonly blob: Blob;
  readonly report: ValidationReport;
  readonly measurements: ExportMeasurements;
}

/**
 * Codecs to try, best first.
 *
 * A 1080×1920 frame needs H.264 level 4.0 — level 3.x cannot describe it, so
 * the familiar `avc1.42E01E` baseline string would be rejected. High profile
 * gives the best quality per bit and is universally decodable in 2026; Main and
 * Baseline follow for anything unusual.
 */
const CODEC_CANDIDATES = ['avc1.640028', 'avc1.4D0028', 'avc1.42E028'] as const;

/** Size of the thumbnail each frame is measured on. */
const MEASURE_WIDTH = 48;

/** Frames to encode between yields, so the page keeps responding. */
const FRAMES_PER_YIELD = 10;

/** Keep the encoder fed without letting its queue grow without bound. */
const MAX_QUEUE_DEPTH = 6;

export function isExportSupported(): boolean {
  return (
    typeof VideoEncoder !== 'undefined' &&
    typeof VideoFrame !== 'undefined' &&
    typeof OffscreenCanvas !== 'undefined'
  );
}

const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function pickCodec(spec: ExportSpec): Promise<string> {
  for (const codec of CODEC_CANDIDATES) {
    const support = await VideoEncoder.isConfigSupported({
      codec,
      width: spec.width,
      height: spec.height,
      bitrate: spec.bitrate,
      framerate: spec.fps,
    });
    if (support.supported) {
      return codec;
    }
  }
  throw new ExportUnsupportedError(
    `This browser cannot encode H.264 at ${spec.width}×${spec.height}. Try Chrome, Edge, or Safari 26 or newer.`,
  );
}

/** Relative luminance of a thumbnail, linearized so the value means something. */
function meanLuminance(pixels: Uint8ClampedArray): number {
  const toLinear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };

  let total = 0;
  const pixelCount = pixels.length / 4;
  for (let at = 0; at < pixels.length; at += 4) {
    total +=
      0.2126 * toLinear(pixels[at]!) +
      0.7152 * toLinear(pixels[at + 1]!) +
      0.0722 * toLinear(pixels[at + 2]!);
  }
  return pixelCount === 0 ? 0 : total / pixelCount;
}

export async function exportCanvasLoop(options: ExportOptions): Promise<ExportResult> {
  if (!isExportSupported()) {
    throw new ExportUnsupportedError(
      'This browser does not support WebCodecs, which Latent needs to write an MP4. Try Chrome, Edge, or Safari 26 or newer.',
    );
  }

  const spec = options.spec ?? CANVAS_EXPORT_DEFAULT;
  const { cover, timeline, preset, segment, onProgress } = options;
  const frameCount = frameCountForLoop(segment.durationSec, spec.fps);
  const codec = await pickCodec(spec);

  const canvas = new OffscreenCanvas(spec.width, spec.height);
  const renderer = CoverRenderer.create(canvas);

  // Small canvas the frames are measured on. Downscaling on the GPU is far
  // cheaper than reading back a full 1080×1920 frame each time.
  const measureHeight = Math.max(1, Math.round((MEASURE_WIDTH * spec.height) / spec.width));
  const measureCanvas = new OffscreenCanvas(MEASURE_WIDTH, measureHeight);
  const measureContext = measureCanvas.getContext('2d', { willReadFrequently: true });
  if (!measureContext) {
    renderer.dispose();
    throw new ExportUnsupportedError('This browser could not provide a 2D context for measurement.');
  }

  const measureCurrentFrame = (): Uint8ClampedArray => {
    measureContext.drawImage(canvas, 0, 0, MEASURE_WIDTH, measureHeight);
    return measureContext.getImageData(0, 0, MEASURE_WIDTH, measureHeight).data;
  };

  try {
    renderer.resize(spec.width, spec.height);
    renderer.setCover(cover);

    // The untouched cover, for the first-frame comparison. Rendered before the
    // loop so frame 0 can be checked against it rather than against intent.
    renderer.render(STATIC_FRAME);
    const coverPixels = Uint8ClampedArray.from(measureCurrentFrame());

    const target = new ArrayBufferTarget();
    const muxer = new Muxer({
      target,
      // No `audio` key, so the file has no audio track at all — which is what
      // the Canvas specification requires.
      video: { codec: 'avc', width: spec.width, height: spec.height, frameRate: spec.fps },
      fastStart: 'in-memory',
    });

    let encoderError: Error | null = null;
    const encoder = new VideoEncoder({
      output: (chunk, metadata) => muxer.addVideoChunk(chunk, metadata),
      error: (error) => {
        encoderError = error;
      },
    });
    encoder.configure({
      codec,
      width: spec.width,
      height: spec.height,
      bitrate: spec.bitrate,
      framerate: spec.fps,
      latencyMode: 'quality',
      // 'avc' produces the avcC description the MP4 container needs; 'annexb'
      // would produce a stream the muxer cannot describe.
      avc: { format: 'avc' },
    });

    const cycles = resolveCycles(preset);
    const luminance: number[] = [];
    let firstFrameMatchesCover = true;
    const microsecondsPerFrame = 1_000_000 / spec.fps;

    for (let frame = 0; frame < frameCount; frame += 1) {
      if (encoderError) {
        throw encoderError;
      }

      // Phase comes from the frame index alone. Nothing here reads a clock.
      const phase = frame / frameCount;
      const sample = sampleFeatures(
        timeline,
        timelineFrameFor(segment, phase, timeline.fps),
      );
      renderer.render({ phase, amounts: resolveAmounts(preset, sample), cycles });

      const pixels = measureCurrentFrame();
      luminance.push(meanLuminance(pixels));
      if (frame === 0) {
        firstFrameMatchesCover = pixels.every((value, at) => value === coverPixels[at]);
      }

      const videoFrame = new VideoFrame(canvas, {
        timestamp: Math.round(frame * microsecondsPerFrame),
        duration: Math.round(microsecondsPerFrame),
      });
      encoder.encode(videoFrame, { keyFrame: frame === 0 });
      videoFrame.close();

      while (encoder.encodeQueueSize > MAX_QUEUE_DEPTH) {
        await nextTick();
      }
      if (frame % FRAMES_PER_YIELD === 0) {
        onProgress?.(frame / frameCount);
        await nextTick();
      }
    }

    await encoder.flush();
    encoder.close();
    if (encoderError) {
      throw encoderError;
    }
    muxer.finalize();
    onProgress?.(1);

    const bytes = new Uint8Array(target.buffer);
    const measurements: ExportMeasurements = {
      durationSec: frameCount / spec.fps,
      fps: spec.fps,
      frameCount,
      width: spec.width,
      height: spec.height,
      luminance,
      firstFrameMatchesCover,
    };

    return {
      blob: new Blob([bytes], { type: 'video/mp4' }),
      report: validateCanvasExport(bytes, measurements),
      measurements,
    };
  } finally {
    renderer.dispose();
  }
}

/** A filename an artist will recognise later. */
export function exportFilename(trackName: string, preset: Preset): string {
  const stem = trackName.replace(/\.[^.]+$/, '') || 'canvas';
  const safe = `${stem}-${preset.id}`.replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/-+/g, '-');
  return `${safe}-canvas.mp4`;
}
