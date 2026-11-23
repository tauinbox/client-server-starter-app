/**
 * Returns the format number of a queue job or of a stored job payload. Data
 * that has no number was written before the formats existed, which is format 1.
 */
export function formatOf(data: object): number {
  return 'format' in data && typeof data.format === 'number' ? data.format : 1;
}
