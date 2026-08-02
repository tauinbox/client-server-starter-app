import { defineConfig } from 'vitest/config';

/**
 * Vitest options the `@angular/build:unit-test` builder does not expose.
 * Referenced from `angular.json` via the `runnerConfig` option.
 */
export default defineConfig({
  test: {
    // The slowest TestBed specs sit at ~3s idle, so Vitest's 5000ms default
    // leaves no headroom once the workers compete for CPU.
    testTimeout: 15000
  }
});
