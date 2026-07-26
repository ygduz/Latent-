import { useCallback, useId, useRef, useState } from 'react';

interface DropZoneProps {
  readonly onFile: (file: File) => void;
  readonly disabled?: boolean;
}

/**
 * Cover art intake: drag and drop, or click to pick. Handles only the gesture —
 * decoding and validation belong to the engine (`intake/coverImage.ts`).
 */
export function DropZone({ onFile, disabled = false }: DropZoneProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const takeFirstFile = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (file) {
        onFile(file);
      }
    },
    [onFile],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setIsDragging(false);
      if (!disabled) {
        takeFirstFile(event.dataTransfer.files);
      }
    },
    [disabled, takeFirstFile],
  );

  const handleDragOver = useCallback(
    (event: React.DragEvent) => {
      // Required, or the browser navigates to the dropped file instead.
      event.preventDefault();
      if (!disabled) {
        setIsDragging(true);
      }
    },
    [disabled],
  );

  return (
    <div
      className={`dropzone${isDragging ? ' is-dragging' : ''}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={() => setIsDragging(false)}
    >
      <label htmlFor={inputId} className="dropzone-label">
        <strong>Drop your cover art</strong>
        <span>or choose a file — PNG, JPEG or WebP, square and at least 1080px</span>
      </label>
      <input
        id={inputId}
        ref={inputRef}
        type="file"
        accept="image/*"
        disabled={disabled}
        onChange={(event) => {
          takeFirstFile(event.target.files);
          // Reset so picking the same file twice still fires a change event.
          event.target.value = '';
        }}
      />
    </div>
  );
}
