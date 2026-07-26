import { useCallback, useRef, useState } from 'react';
import type { LoopSegment } from '../../engine/types';
import { clampSegment } from '../../engine/loop';
import { CANVAS_SPEC } from '../../engine/export/spec';
import { formatSeconds } from '../format';

interface SegmentPickerProps {
  readonly peaks: Float32Array;
  readonly trackDurationSec: number;
  readonly segment: LoopSegment;
  /** Called when a drag or keystroke finishes, never mid-drag. */
  readonly onChange: (segment: LoopSegment) => void;
}

type DragMode = 'move' | 'start' | 'end';

interface Drag {
  readonly mode: DragMode;
  readonly pointerId: number;
  readonly originX: number;
  readonly origin: LoopSegment;
}

/** Keyboard nudge sizes. */
const NUDGE_SEC = 0.1;
const COARSE_NUDGE_SEC = 1;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

/**
 * Waveform strip for choosing which few seconds to loop.
 *
 * The dragged segment is held as a local draft and only reported on release.
 * Reporting every pointer move would restart audio playback dozens of times a
 * second, which sounds broken; the draft is what makes the strip feel live
 * without that happening.
 */
export function SegmentPicker({
  peaks,
  trackDurationSec,
  segment,
  onChange,
}: SegmentPickerProps) {
  const stripRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [draft, setDraft] = useState<LoopSegment | null>(null);

  const shown = draft ?? segment;

  const minDuration = Math.min(CANVAS_SPEC.minDurationSec, trackDurationSec);
  const maxDuration = Math.min(CANVAS_SPEC.maxDurationSec, trackDurationSec);

  const secondsPerPixel = useCallback(() => {
    const width = stripRef.current?.getBoundingClientRect().width ?? 1;
    return trackDurationSec / Math.max(1, width);
  }, [trackDurationSec]);

  const resize = useCallback(
    (drag: Drag, deltaSec: number): LoopSegment => {
      const { origin } = drag;
      const end = origin.startSec + origin.durationSec;

      switch (drag.mode) {
        case 'move':
          return {
            startSec: clamp(origin.startSec + deltaSec, 0, trackDurationSec - origin.durationSec),
            durationSec: origin.durationSec,
          };
        case 'start': {
          // Dragging the left edge moves the start and changes the length at
          // once, so the end has to stay put.
          const startSec = clamp(
            origin.startSec + deltaSec,
            Math.max(0, end - maxDuration),
            end - minDuration,
          );
          return { startSec, durationSec: end - startSec };
        }
        case 'end':
          return {
            startSec: origin.startSec,
            durationSec: clamp(
              origin.durationSec + deltaSec,
              minDuration,
              Math.min(maxDuration, trackDurationSec - origin.startSec),
            ),
          };
      }
    },
    [maxDuration, minDuration, trackDurationSec],
  );

  const beginDrag = useCallback(
    (mode: DragMode) => (event: React.PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        mode,
        pointerId: event.pointerId,
        originX: event.clientX,
        origin: segment,
      };
      setDraft(segment);
    },
    [segment],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) {
        return;
      }
      const deltaSec = (event.clientX - drag.originX) * secondsPerPixel();
      setDraft(clampSegment(resize(drag, deltaSec), trackDurationSec));
    },
    [resize, secondsPerPixel, trackDurationSec],
  );

  const endDrag = useCallback(
    (event: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) {
        return;
      }
      dragRef.current = null;
      const settled = draft;
      setDraft(null);
      if (settled) {
        onChange(settled);
      }
    },
    [draft, onChange],
  );

  const nudge = useCallback(
    (event: React.KeyboardEvent) => {
      const step = event.shiftKey ? COARSE_NUDGE_SEC : NUDGE_SEC;
      const direction = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
      if (direction === 0) {
        return;
      }
      event.preventDefault();
      onChange(
        clampSegment(
          { ...segment, startSec: segment.startSec + direction * step },
          trackDurationSec,
        ),
      );
    },
    [onChange, segment, trackDurationSec],
  );

  const leftPercent = (shown.startSec / trackDurationSec) * 100;
  const widthPercent = (shown.durationSec / trackDurationSec) * 100;
  const latestStart = Math.max(0, trackDurationSec - shown.durationSec);

  return (
    <section className="segment" aria-label="Loop segment">
      <h2>Loop</h2>

      <div
        className="segment-strip"
        ref={stripRef}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <svg
          className="segment-wave"
          viewBox={`0 0 ${peaks.length} 100`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {Array.from(peaks, (peak, index) => {
            const seconds = (index / peaks.length) * trackDurationSec;
            const inSegment =
              seconds >= shown.startSec && seconds < shown.startSec + shown.durationSec;
            const height = Math.max(1, peak * 96);
            return (
              <rect
                key={index}
                x={index + 0.1}
                width={0.8}
                y={50 - height / 2}
                height={height}
                className={inSegment ? 'bar is-inside' : 'bar'}
              />
            );
          })}
        </svg>

        <div
          className="segment-window"
          style={{ left: `${leftPercent}%`, width: `${widthPercent}%` }}
          role="slider"
          tabIndex={0}
          aria-label="Loop start"
          aria-valuemin={0}
          aria-valuemax={Number(latestStart.toFixed(2))}
          aria-valuenow={Number(shown.startSec.toFixed(2))}
          aria-valuetext={`starts at ${formatSeconds(shown.startSec)}`}
          onPointerDown={beginDrag('move')}
          onKeyDown={nudge}
          data-testid="segment-window"
        >
          <span
            className="segment-handle segment-handle-start"
            onPointerDown={beginDrag('start')}
            data-testid="segment-handle-start"
          />
          <span
            className="segment-handle segment-handle-end"
            onPointerDown={beginDrag('end')}
            data-testid="segment-handle-end"
          />
        </div>
      </div>

      <div className="segment-controls">
        <label className="segment-duration">
          <span>
            Length <strong>{shown.durationSec.toFixed(1)}s</strong>
          </span>
          <input
            type="range"
            min={minDuration}
            max={maxDuration}
            step={0.1}
            value={shown.durationSec}
            disabled={maxDuration <= minDuration}
            onChange={(event) =>
              onChange(
                clampSegment(
                  { ...segment, durationSec: Number(event.target.value) },
                  trackDurationSec,
                ),
              )
            }
          />
        </label>
        <p className="segment-readout">
          {formatSeconds(shown.startSec)} → {formatSeconds(shown.startSec + shown.durationSec)}
          {trackDurationSec < CANVAS_SPEC.minDurationSec ? (
            <span className="segment-warn">
              {' '}
              · track is shorter than the {CANVAS_SPEC.minDurationSec}s minimum
            </span>
          ) : null}
        </p>
      </div>
    </section>
  );
}
