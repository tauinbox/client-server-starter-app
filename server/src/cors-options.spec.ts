import { corsOptions } from './cors-options';

describe('corsOptions', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env['CORS_ORIGINS'];
    delete process.env['ENVIRONMENT'];
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('CORS_ORIGINS=*', () => {
    it('throws in production', () => {
      process.env['CORS_ORIGINS'] = '*';
      process.env['ENVIRONMENT'] = 'production';
      expect(() => corsOptions()).toThrow(
        'CORS_ORIGINS=* is not allowed in production'
      );
    });

    it('allows wildcard in non-production with credentials: false', () => {
      process.env['CORS_ORIGINS'] = '*';
      process.env['ENVIRONMENT'] = 'local';
      const result = corsOptions() as Record<string, unknown>;
      expect(result['origin']).toBe('*');
      expect(result['credentials']).toBe(false);
    });
  });

  describe('CORS_ORIGINS with specific origins', () => {
    it('splits comma-separated origins and sets credentials: true', () => {
      process.env['CORS_ORIGINS'] =
        'https://app.example.com,https://admin.example.com';
      const result = corsOptions() as Record<string, unknown>;
      expect(result['origin']).toEqual([
        'https://app.example.com',
        'https://admin.example.com'
      ]);
      expect(result['credentials']).toBe(true);
    });
  });

  describe('local environment without CORS_ORIGINS', () => {
    it('returns localhost origins with credentials: true', () => {
      process.env['ENVIRONMENT'] = 'local';
      const result = corsOptions() as Record<string, unknown>;
      expect(result['origin']).toEqual([
        'http://localhost:4200',
        'http://localhost:3000'
      ]);
      expect(result['credentials']).toBe(true);
    });
  });

  describe('no env vars set', () => {
    it('returns origin: false', () => {
      const result = corsOptions() as Record<string, unknown>;
      expect(result['origin']).toBe(false);
    });
  });
});
