/**
 * The share of `total` that `translated` covers, rounded down to two decimals (0.29 for 29 of 100).
 *
 * The percentage is worked out on whole numbers before it is divided: `(29 / 100) * 100` is 28.999999999999996,
 * which would round down to 28 %, whereas `(29 * 100) / 100` is exactly 29. A division whose true result is a
 * whole number is exact, so a complete locale reads 1 and a share that is a whole percent is never cut by one.
 * The result is always from 0 to 1: no terms, or a count that is not a number, give 0, and a count above the total gives 1.
 */
export function progressRatio(translated: number, total: number): number {
  if (!Number.isFinite(translated) || !Number.isFinite(total) || total <= 0 || translated <= 0) {
    return 0;
  }
  const percent = Math.floor((translated * 100) / total);
  return Math.min(percent, 100) / 100;
}
