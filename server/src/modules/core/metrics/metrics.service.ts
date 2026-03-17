import { Injectable } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import type { Counter, Histogram } from 'prom-client';

export type AuthEvent =
  | 'login_success'
  | 'login_failure'
  | 'token_refresh_success'
  | 'token_refresh_failure'
  | 'logout'
  | 'register';

@Injectable()
export class MetricsService {
  constructor(
    @InjectMetric('http_requests_total')
    private readonly httpRequestsCounter: Counter<string>,
    @InjectMetric('http_request_duration_seconds')
    private readonly httpDurationHistogram: Histogram<string>,
    @InjectMetric('auth_events_total')
    private readonly authEventsCounter: Counter<string>
  ) {}

  recordHttpRequest(
    method: string,
    route: string,
    statusCode: number,
    durationMs: number
  ): void {
    const labels = { method, route, status_code: String(statusCode) };
    this.httpRequestsCounter.inc(labels);
    this.httpDurationHistogram.observe(labels, durationMs / 1000);
  }

  recordAuthEvent(event: AuthEvent): void {
    this.authEventsCounter.inc({ event });
  }
}
