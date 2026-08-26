import { Injectable } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import type { Counter, Histogram } from 'prom-client';
import type { BillingProviderId } from '@app/shared/types';

export type AuthEvent =
  | 'login_success'
  | 'login_failure'
  | 'token_refresh_success'
  | 'token_refresh_failure'
  | 'token_reuse_detected'
  | 'logout'
  | 'register';

export type PermissionDenialLevel = 'guard' | 'instance';

export type MailJobOutcome = 'completed' | 'failed';

export type CacheName =
  | 'permissions'
  | 'roles'
  | 'resources'
  | 'feature_flags'
  | 'feature_flags_all'
  | 'entitlements';

export type CacheOutcome = 'hit' | 'miss';

@Injectable()
export class MetricsService {
  constructor(
    @InjectMetric('http_requests_total')
    private readonly httpRequestsCounter: Counter<string>,
    @InjectMetric('http_request_duration_seconds')
    private readonly httpDurationHistogram: Histogram<string>,
    @InjectMetric('auth_events_total')
    private readonly authEventsCounter: Counter<string>,
    @InjectMetric('rbac_permission_denied_total')
    private readonly permissionDeniedCounter: Counter<string>,
    @InjectMetric('mail_jobs_processed_total')
    private readonly mailJobsCounter: Counter<string>,
    @InjectMetric('cache_requests_total')
    private readonly cacheRequestsCounter: Counter<string>,
    @InjectMetric('billing_usage_records_unrated_total')
    private readonly unratedUsageCounter: Counter<string>,
    @InjectMetric('billing_off_session_charges_unmatched_total')
    private readonly unmatchedChargeCounter: Counter<string>
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

  recordPermissionDenied(
    level: PermissionDenialLevel,
    action: string,
    subject: string
  ): void {
    this.permissionDeniedCounter.inc({ action, subject, level });
  }

  recordMailJob(outcome: MailJobOutcome): void {
    this.mailJobsCounter.inc({ outcome });
  }

  recordCacheAccess(cache: CacheName, outcome: CacheOutcome): void {
    this.cacheRequestsCounter.inc({ cache, outcome });
  }

  recordUnratedUsage(meter: string): void {
    this.unratedUsageCounter.inc({ meter });
  }

  recordUnmatchedOffSessionCharge(provider: BillingProviderId): void {
    this.unmatchedChargeCounter.inc({ provider });
  }
}
