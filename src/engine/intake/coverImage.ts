import type { CoverImage, CoverImageWarning } from '../types';
import { CANVAS_EXPORT_DEFAULT } from '../export/spec';

export class CoverImageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CoverImageError';
  }
}

/** Artwork narrower than the export frame has to be upscaled to fill it. */
const MIN_USEFUL_EDGE_PX = CANVAS_EXPORT_DEFAULT.width;

/** Tolerance before artwork is called non-square (1% of aspect). */
const SQUARE_TOLERANCE = 0.01;

/**
 * Quality notes about the artwork. Pure and separate from decoding so it can
 * be tested without a browser, and so the UI can warn before doing any work.
 *
 * These never block a render — the artwork always draws. They exist because an
 * export cannot invent detail that was not in the source.
 */
export function validateCoverImage(width: number, height: number): CoverImageWarning[] {
  if (!(width > 0) || !(height > 0)) {
    throw new RangeError(`dimensions must be positive, got ${width}x${height}`);
  }

  const warnings: CoverImageWarning[] = [];

  const shortestEdge = Math.min(width, height);
  if (shortestEdge < MIN_USEFUL_EDGE_PX) {
    warnings.push({
      code: 'low-resolution',
      message:
        `Artwork is ${width}×${height}. Exports are ${MIN_USEFUL_EDGE_PX}px wide, so this ` +
        `will be upscaled and may look soft. ${MIN_USEFUL_EDGE_PX}px or larger is ideal.`,
    });
  }

  if (Math.abs(width / height - 1) > SQUARE_TOLERANCE) {
    warnings.push({
      code: 'not-square',
      message:
        `Artwork is ${width}×${height}, not square. Cover art is square on Spotify, ` +
        `so this may not match the artwork listeners see.`,
    });
  }

  return warnings;
}

/**
 * Decode an image file into a texture-ready bitmap.
 *
 * Nothing is uploaded anywhere — decoding happens in the browser, which is the
 * whole privacy promise of the product.
 */
export async function loadCoverImage(file: File): Promise<CoverImage> {
  if (!file.type.startsWith('image/')) {
    throw new CoverImageError(
      `${file.name || 'That file'} is not an image. Use a PNG, JPEG or WebP.`,
    );
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (cause) {
    throw new CoverImageError(
      `${file.name || 'That image'} could not be decoded. It may be corrupt or an ` +
        `unsupported format.`,
      { cause },
    );
  }

  if (bitmap.width === 0 || bitmap.height === 0) {
    bitmap.close();
    throw new CoverImageError(`${file.name || 'That image'} has no pixels.`);
  }

  return { bitmap, width: bitmap.width, height: bitmap.height };
}
