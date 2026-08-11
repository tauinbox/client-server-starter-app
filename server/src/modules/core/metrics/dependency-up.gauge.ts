import { Gauge, register } from 'prom-client';

export const DEPENDENCY_UP_METRIC_NAME = 'dependency_up';

export const DEPENDENCY_HEALTH_REF = Symbol('DEPENDENCY_HEALTH_REF');

export interface DependencyHealthRef {
  // Latest outcome per dependency, written by the health indicators on every
  // readiness probe and read on scrape. Empty until the first probe runs, so
  // the series only appears for dependencies this deployment actually checks.
  readonly statuses: Map<string, boolean>;
}

export function createDependencyHealthRef(): DependencyHealthRef {
  return { statuses: new Map() };
}

export function createDependencyUpGauge(
  ref: DependencyHealthRef
): Gauge<string> {
  // Re-use the existing metric if already registered (multiple module
  // initializations in the same process during E2E tests or hot-reload).
  const existing = register.getSingleMetric(DEPENDENCY_UP_METRIC_NAME);
  if (existing) {
    return existing as Gauge<string>;
  }
  return new Gauge<string>({
    name: DEPENDENCY_UP_METRIC_NAME,
    help: 'External dependency health as observed by the readiness probe (1 = healthy, 0 = degraded or down)',
    labelNames: ['dependency'],
    collect() {
      for (const [dependency, ok] of ref.statuses) {
        this.set({ dependency }, ok ? 1 : 0);
      }
    }
  });
}
