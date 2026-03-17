import { Test } from '@nestjs/testing';
import { getToken } from '@willsoto/nestjs-prometheus';
import type { Counter, Histogram } from 'prom-client';
import { MetricsService } from './metrics.service';

const mockCounter = { inc: jest.fn() };
const mockHistogram = { observe: jest.fn() };

describe('MetricsService', () => {
  let service: MetricsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        MetricsService,
        {
          provide: getToken('http_requests_total'),
          useValue: mockCounter as unknown as Counter<string>
        },
        {
          provide: getToken('http_request_duration_seconds'),
          useValue: mockHistogram as unknown as Histogram<string>
        },
        {
          provide: getToken('auth_events_total'),
          useValue: mockCounter as unknown as Counter<string>
        }
      ]
    }).compile();

    service = module.get(MetricsService);
  });

  describe('recordHttpRequest', () => {
    it('increments the requests counter with correct labels', () => {
      service.recordHttpRequest('GET', '/api/v1/users', 200, 42);

      expect(mockCounter.inc).toHaveBeenCalledWith({
        method: 'GET',
        route: '/api/v1/users',
        status_code: '200'
      });
    });

    it('observes duration in seconds', () => {
      service.recordHttpRequest('POST', '/api/v1/auth/login', 201, 150);

      expect(mockHistogram.observe).toHaveBeenCalledWith(
        { method: 'POST', route: '/api/v1/auth/login', status_code: '201' },
        0.15
      );
    });
  });

  describe('recordAuthEvent', () => {
    it('increments the auth events counter', () => {
      service.recordAuthEvent('login_success');

      expect(mockCounter.inc).toHaveBeenCalledWith({ event: 'login_success' });
    });
  });
});
