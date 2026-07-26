import { useCallback, useId, useState } from 'react';

interface DropZoneProps {
  readonly onFile: (file: File) => void;
  /** An `accept` value for the file input, e.g. `image/*`. */
  readonly accept: string;
  readonly title: string;
  readonly hint: string;
  readonly disabled?: boolean;
}

/**
 * File intake: drag and drop, or click to pick. Handles only the gesture —
 * decoding and validation belong to the engine.
 */
export function DropZone({ onFile, accept, title, hint, disabled = false }: DropZoneProps) {
  const inputId = useId();
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
        <strong>{title}</strong>
        <span>{hint}</span>
      </label>
      <input
        id={inputId}
        type="file"
        accept={accept}
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
