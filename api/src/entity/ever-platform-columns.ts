import { ValueTransformer } from 'typeorm';

/**
 * Times of the Ever Platform tables are whole milliseconds since the epoch in a `bigint` column: the same value and the
 * same comparisons on sqlite, postgres and mysql, with no time zone involved. postgres and mysql return a `bigint` as a
 * string, so it is read back as a number.
 */
export const epochMsTransformer: ValueTransformer = {
  to: (value: number | null | undefined) => (value === undefined ? undefined : value),
  from: (value: string | number | null) => (value === null || value === undefined ? null : Number(value)),
};
