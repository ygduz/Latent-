import type { LoopSegment, Normalized } from '../types';
import { loopPhase } from '../loop';

/**
 * Plays a loop segment and reports where in the loop it is.
 *
 * The preview's clock comes from the audio context rather than from
 * `requestAnimationFrame`, so what is heard and what is drawn cannot drift
 * apart. Export does not use this at all — it renders from frame indices, which
 * is why an export is deterministic while a preview is merely accurate.
 */
export class LoopPlayer {
  private context: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private startedAtContextTime = 0;
  private pausedPhase: Normalized = 0;
  private disposed = false;

  constructor(
    private readonly buffer: AudioBuffer,
    private segment: LoopSegment,
  ) {}

  get playing(): boolean {
    return this.source !== null;
  }

  /** Position within the loop, 0..1. Holds still while paused. */
  phase(): Normalized {
    if (!this.context || !this.source) {
      return this.pausedPhase;
    }
    const elapsed = this.context.currentTime - this.startedAtContextTime;
    return loopPhase(elapsed, this.segment.durationSec);
  }

  /**
   * Start or restart playback. Must be called from a user gesture — browsers
   * refuse to start an audio context otherwise.
   */
  async play(): Promise<void> {
    this.assertUsable();
    this.stopSource();

    const context = (this.context ??= new AudioContext());
    if (context.state === 'suspended') {
      await context.resume();
    }

    const source = context.createBufferSource();
    source.buffer = this.buffer;
    source.loop = true;
    source.loopStart = this.segment.startSec;
    source.loopEnd = this.segment.startSec + this.segment.durationSec;
    source.connect(context.destination);

    // Resume from where the last pause left off, so toggling play does not jump.
    const offsetIntoLoop = this.pausedPhase * this.segment.durationSec;
    source.start(0, this.segment.startSec + offsetIntoLoop);

    this.startedAtContextTime = context.currentTime - offsetIntoLoop;
    this.source = source;
  }

  /** Pause, keeping the current position. */
  pause(): void {
    if (!this.source) {
      return;
    }
    this.pausedPhase = this.phase();
    this.stopSource();
  }

  /** Stop and return to the start of the loop. */
  stop(): void {
    this.stopSource();
    this.pausedPhase = 0;
  }

  /** Change which part of the track loops, keeping playback state. */
  setSegment(segment: LoopSegment): void {
    this.assertUsable();
    const wasPlaying = this.playing;
    this.pause();
    this.segment = segment;
    this.pausedPhase = 0;
    if (wasPlaying) {
      void this.play();
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.stopSource();
    void this.context?.close();
    this.context = null;
    this.disposed = true;
  }

  private stopSource(): void {
    if (!this.source) {
      return;
    }
    this.source.onended = null;
    try {
      this.source.stop();
    } catch {
      // Already stopped; nothing to undo.
    }
    this.source.disconnect();
    this.source = null;
  }

  private assertUsable(): void {
    if (this.disposed) {
      throw new Error('LoopPlayer has been disposed');
    }
  }
}
