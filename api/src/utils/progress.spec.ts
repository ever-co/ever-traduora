import { progressRatio } from './progress';

describe('progressRatio', () => {
  it('does not cut a whole percent by one to floating point error', () => {
    // (29 / 100) * 100 is 28.999999999999996 and (57 / 100) * 100 is 56.99999999999999
    expect(progressRatio(29, 100)).toBe(0.29);
    expect(progressRatio(57, 100)).toBe(0.57);
    expect(progressRatio(58, 100)).toBe(0.58);
  });

  it('keeps every whole percent of a total of 100 and of 200', () => {
    for (let n = 0; n <= 100; n++) {
      expect(progressRatio(n, 100)).toBe(n / 100);
      expect(progressRatio(n * 2, 200)).toBe(n / 100);
    }
  });

  it('keeps rounding a share that is not a whole percent down', () => {
    expect(progressRatio(1, 3)).toBe(0.33);
    expect(progressRatio(2, 3)).toBe(0.66);
    expect(progressRatio(199, 200)).toBe(0.99);
    expect(progressRatio(1, 1000)).toBe(0);
  });

  it('reads 1 only when everything is translated', () => {
    expect(progressRatio(7, 7)).toBe(1);
    expect(progressRatio(6, 7)).toBe(0.85);
    expect(progressRatio(999, 1000)).toBe(0.99);
  });

  it('gives 0 when there is nothing to translate or nothing translated', () => {
    expect(progressRatio(0, 0)).toBe(0);
    expect(progressRatio(5, 0)).toBe(0);
    expect(progressRatio(0, 10)).toBe(0);
    expect(progressRatio(NaN, 10)).toBe(0);
    expect(progressRatio(3, NaN)).toBe(0);
    expect(progressRatio(3, Infinity)).toBe(0);
  });

  it('never goes above 1 when the stored total is behind the count', () => {
    expect(progressRatio(12, 10)).toBe(1);
  });
});
