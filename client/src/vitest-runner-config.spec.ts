import { describe, expect, it } from 'vitest';

describe('vitest runner configuration', () => {
  it('raises the test timeout above the 5000ms default', ({ task }) => {
    expect(task.timeout).toBeGreaterThanOrEqual(15000);
  });
});
