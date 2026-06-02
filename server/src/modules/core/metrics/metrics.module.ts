import { Global, Module } from '@nestjs/common';
import {
  PrometheusModule,
  makeCounterProvider,
  makeHistogramProvider,
  getToken
} from '@willsoto/nestjs-prometheus';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { Gauge, register } from 'prom-client';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';
import { DB_POOL_METRIC_NAME, createDbPoolGauge } from './db-pool.gauge';

export interface SseConnectionsRef {
  getCount: () => number;
}

export const SSE_CONNECTIONS_REF = Symbol('SSE_CONNECTIONS_REF');

export interface MailQueueRef {
  // Returns BullMQ job counts by state, or null when no queue is configured
  // (REDIS_URL unset → MailService sends in-process, MailProcessor not registered).
  getJobCounts: () => Promise<Record<string, number>> | null;
}

export const MAIL_QUEUE_REF = Symbol('MAIL_QUEUE_REF');

@Global()
@Module({
  imports: [
    PrometheusModule.register({
      path: '/metrics',
      controller: MetricsController,
      defaultMetrics: { enabled: true }
    })
  ],
  providers: [
    MetricsService,
    makeCounterProvider({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status_code']
    }),
    makeHistogramProvider({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]
    }),
    makeCounterProvider({
      name: 'auth_events_total',
      help: 'Total number of authentication events',
      labelNames: ['event']
    }),
    makeCounterProvider({
      name: 'rbac_permission_denied_total',
      help: 'Total number of RBAC/ABAC permission denials',
      labelNames: ['action', 'subject', 'level']
    }),
    makeCounterProvider({
      name: 'mail_jobs_processed_total',
      help: 'Total number of mail jobs processed by the queue worker',
      labelNames: ['outcome']
    }),
    makeCounterProvider({
      name: 'cache_requests_total',
      help: 'Total cache lookups by logical cache and hit/miss outcome',
      labelNames: ['cache', 'outcome']
    }),
    {
      provide: SSE_CONNECTIONS_REF,
      useFactory: (): SseConnectionsRef => ({ getCount: () => 0 })
    },
    {
      provide: MAIL_QUEUE_REF,
      useFactory: (): MailQueueRef => ({ getJobCounts: () => null })
    },
    {
      provide: getToken('mail_queue_jobs'),
      useFactory: (ref: MailQueueRef): Gauge<string> => {
        const existing = register.getSingleMetric('mail_queue_jobs');
        if (existing) {
          return existing as Gauge<string>;
        }
        return new Gauge<string>({
          name: 'mail_queue_jobs',
          help: 'Number of mail-queue jobs by state',
          labelNames: ['state'],
          async collect() {
            try {
              const counts = await ref.getJobCounts();
              if (!counts) {
                return;
              }
              for (const [state, value] of Object.entries(counts)) {
                this.set({ state }, value);
              }
            } catch {
              // Scraping must never fail because Redis is briefly unreachable;
              // leave the previous sample in place and try again next scrape.
            }
          }
        });
      },
      inject: [MAIL_QUEUE_REF]
    },
    {
      provide: getToken('sse_connections_active'),
      useFactory: (ref: SseConnectionsRef): Gauge<string> => {
        // Re-use the existing metric if already registered (e.g. multiple module
        // initializations in the same process during E2E tests or hot-reload).
        const existing = register.getSingleMetric('sse_connections_active');
        if (existing) {
          return existing as Gauge<string>;
        }
        return new Gauge<string>({
          name: 'sse_connections_active',
          help: 'Number of currently active SSE connections',
          collect() {
            this.set(ref.getCount());
          }
        });
      },
      inject: [SSE_CONNECTIONS_REF]
    },
    {
      provide: getToken(DB_POOL_METRIC_NAME),
      useFactory: (dataSource: DataSource): Gauge<string> =>
        createDbPoolGauge(dataSource),
      inject: [getDataSourceToken()]
    }
  ],
  exports: [MetricsService, SSE_CONNECTIONS_REF, MAIL_QUEUE_REF]
})
export class MetricsModule {}
