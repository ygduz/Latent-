/**
 * Radix-2 FFT and window functions.
 *
 * Self-contained rather than a dependency: it is ~60 lines, it must be
 * bit-for-bit deterministic (the product promises identical output for
 * identical input), and it keeps the engine dependency-free so it can be
 * embedded elsewhere later.
 */

export function isPowerOfTwo(n: number): boolean {
  return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
}

/**
 * In-place complex FFT. `re` and `im` must be the same power-of-two length.
 *
 * Twiddle factors are computed with `Math.cos`/`Math.sin` per butterfly rather
 * than by recurrence: a recurrence is faster but accumulates error across
 * stages, and reproducibility matters more here than speed. Analysis runs once
 * per track, not per frame.
 */
export function fftInPlace(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  if (im.length !== n) {
    throw new RangeError(`real and imaginary parts must match: ${n} vs ${im.length}`);
  }
  if (!isPowerOfTwo(n)) {
    throw new RangeError(`FFT length must be a power of two, got ${n}`);
  }

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      const tmpRe = re[i]!;
      re[i] = re[j]!;
      re[j] = tmpRe;
      const tmpIm = im[i]!;
      im[i] = im[j]!;
      im[j] = tmpIm;
    }
  }

  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = (-2 * Math.PI) / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k += 1) {
        const angle = step * k;
        const wRe = Math.cos(angle);
        const wIm = Math.sin(angle);

        const evenIndex = start + k;
        const oddIndex = evenIndex + half;

        const oddRe = re[oddIndex]!;
        const oddIm = im[oddIndex]!;
        const rotRe = oddRe * wRe - oddIm * wIm;
        const rotIm = oddRe * wIm + oddIm * wRe;

        const evenRe = re[evenIndex]!;
        const evenIm = im[evenIndex]!;

        re[evenIndex] = evenRe + rotRe;
        im[evenIndex] = evenIm + rotIm;
        re[oddIndex] = evenRe - rotRe;
        im[oddIndex] = evenIm - rotIm;
      }
    }
  }
}

/**
 * Magnitude spectrum for the non-redundant bins (0..n/2 inclusive), scaled so
 * a full-scale sine at an exact bin frequency reads ~1.0 whatever the FFT size.
 */
export function magnitudesInto(re: Float32Array, im: Float32Array, out: Float32Array): void {
  const n = re.length;
  const binCount = n / 2 + 1;
  if (out.length !== binCount) {
    throw new RangeError(`output must hold ${binCount} bins, got ${out.length}`);
  }
  for (let bin = 0; bin < binCount; bin += 1) {
    out[bin] = Math.hypot(re[bin]!, im[bin]!) / (n / 2);
  }
}

/** Number of magnitude bins an FFT of this size produces. */
export function binCountFor(fftSize: number): number {
  return fftSize / 2 + 1;
}

/** Centre frequency of a magnitude bin, in Hz. */
export function binFrequency(bin: number, fftSize: number, sampleRate: number): number {
  return (bin * sampleRate) / fftSize;
}

/**
 * Periodic Hann window. Reduces spectral leakage so band energies reflect real
 * content rather than the edges of the analysis frame.
 */
export function hannWindow(size: number): Float32Array {
  if (!(size > 0) || !Number.isInteger(size)) {
    throw new RangeError(`window size must be a positive integer, got ${size}`);
  }
  const window = new Float32Array(size);
  for (let i = 0; i < size; i += 1) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / size));
  }
  return window;
}
