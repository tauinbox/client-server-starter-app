import { Global, Module } from '@nestjs/common';
import {
  PrometheusModule,
  makeCounterProvider,
  makeHistogramProvider,
  getToken
} from '@willsoto/nestjs-prometheus';
import { Gauge } from 'prom-client';
import { MetricsService } from './metrics.service';

export interface SseConnectionsRef {
  getCount: () => number;
}

export const SSE_CONNECTIONS_REF = Symbol('SSE_CONNECTIONS_REF');

@Global()
@Module({
  imports: [
    PrometheusModule.register({
      path: '/metrics',
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
    {
      provide: SSE_CONNECTIONS_REF,
      useFactory: (): SseConnectionsRef => ({ getCount: () => 0 })
    },
    {
      provide: getToken('sse_connections_active'),
      useFactory: (ref: SseConnectionsRef): Gauge<string> => {
        return new Gauge<string>({
          name: 'sse_connections_active',
          help: 'Number of currently active SSE connections',
          collect() {
            this.set(ref.getCount());
          }
        });
      },
      inject: [SSE_CONNECTIONS_REF]
    }
  ],
  exports: [MetricsService, SSE_CONNECTIONS_REF]
})
export class MetricsModule {}
