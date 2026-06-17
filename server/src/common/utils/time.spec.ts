import { Temporal } from '@app/shared/utils/time';

describe('time (Temporal polyfill barrel)', () => {
  it('exposes the Temporal API', () => {
    expect(typeof Temporal.PlainDate.from).toBe('function');
  });

  it('clamps month-end when adding a month', () => {
    const jan31 = Temporal.PlainDate.from('2024-01-31');
    expect(jan31.add({ months: 1 }).toString()).toBe('2024-02-29');
  });

  it('handles leap-year boundaries', () => {
    const feb29 = Temporal.PlainDate.from('2024-02-29');
    expect(feb29.add({ years: 1 }).toString()).toBe('2025-02-28');
  });
});
