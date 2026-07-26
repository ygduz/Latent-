import { describe, expect, it } from 'vitest';
import { formatSeconds } from '../src/app/format';

describe('formatSeconds', () => {
  it('shows minutes, seconds and a tenth', () => {
    expect(formatSeconds(0)).toBe('0:00.0');
    expect(formatSeconds(5.25)).toBe('0:05.3');
    expect(formatSeconds(65)).toBe('1:05.0');
    expect(formatSeconds(600.4)).toBe('10:00.4');
  });

  it('pads seconds so the readout does not jitter in width', () => {
    expect(formatSeconds(9.9)).toBe('0:09.9');
    expect(formatSeconds(10)).toBe('0:10.0');
  });

  it('treats negative input as zero', () => {
    expect(formatSeconds(-3)).toBe('0:00.0');
  });
});
