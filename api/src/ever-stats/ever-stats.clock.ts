/** The clock of the statistics module (milliseconds since the epoch); tests replace it. */
export type EverStatsClock = () => number;

export const EVER_STATS_CLOCK = Symbol('ever stats clock');

export const systemClock: EverStatsClock = () => Date.now();

/** `YYYY-MM` of a time, in UTC. */
export function monthOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 7);
}

/** `YYYY-MM-DD` of a time, in UTC. */
export function dayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The month before `period` (`YYYY-MM`). */
export function previousMonth(period: string): string {
  const [year, month] = period.split('-').map(Number);
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
}

/** The first instant of `period` (`YYYY-MM`, UTC) and the first instant of the month after it. */
export function periodRange(period: string): { start: Date; end: Date } {
  const [year, month] = period.split('-').map(Number);
  return { start: new Date(Date.UTC(year, month - 1, 1)), end: new Date(Date.UTC(year, month, 1)) };
}
