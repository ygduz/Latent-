import { describe, expect, it } from 'vitest';
import { validateCoverImage } from '../src/engine/intake/coverImage';

const codes = (width: number, height: number) =>
  validateCoverImage(width, height).map((warning) => warning.code);

describe('validateCoverImage', () => {
  it('passes typical cover art with no warnings', () => {
    expect(codes(3000, 3000)).toEqual([]);
    expect(codes(1080, 1080)).toEqual([]);
  });

  it('warns when artwork is narrower than the export frame', () => {
    expect(codes(640, 640)).toContain('low-resolution');
    // 1080 is exactly the export width, so it is enough.
    expect(codes(1080, 1080)).not.toContain('low-resolution');
    expect(codes(1079, 1079)).toContain('low-resolution');
  });

  it('warns when artwork is not square', () => {
    expect(codes(3000, 2000)).toContain('not-square');
    expect(codes(1920, 1080)).toContain('not-square');
  });

  it('tolerates artwork that is square within a percent', () => {
    expect(codes(3000, 3000)).not.toContain('not-square');
    expect(codes(3000, 2995)).not.toContain('not-square');
  });

  it('can report both problems at once', () => {
    expect(codes(800, 600)).toEqual(
      expect.arrayContaining(['low-resolution', 'not-square']),
    );
  });

  it('includes the actual dimensions so the message is actionable', () => {
    const [warning] = validateCoverImage(500, 500);
    expect(warning?.message).toContain('500×500');
  });

  it('rejects non-positive dimensions', () => {
    expect(() => validateCoverImage(0, 100)).toThrow(RangeError);
    expect(() => validateCoverImage(100, -5)).toThrow(RangeError);
  });
});
