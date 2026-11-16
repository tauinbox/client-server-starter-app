import { TurnstileVerifier } from './turnstile.verifier';

describe('TurnstileVerifier', () => {
  let originalFetch: typeof fetch;
  let mockFetch: jest.Mock;
  const verifier = new TurnstileVerifier({
    siteKey: 'site',
    secretKey: 'secret-123'
  });

  beforeEach(() => {
    originalFetch = global.fetch;
    mockFetch = jest.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('names its provider and exposes the site key', () => {
    expect(verifier.provider).toBe('turnstile');
    expect(verifier.siteKey).toBe('site');
  });

  it('POSTs secret + token + remoteip and returns true on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true })
    });

    await expect(verifier.verify('user-token', '203.0.113.5')).resolves.toBe(
      true
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [[url, init]] = mockFetch.mock.calls as [
      [string, { body: string; method: string }]
    ];

    expect(url).toBe(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify'
    );
    expect(init.method).toBe('POST');
    const params = new URLSearchParams(init.body);

    expect(params.get('secret')).toBe('secret-123');
    expect(params.get('response')).toBe('user-token');
    expect(params.get('remoteip')).toBe('203.0.113.5');
  });

  it('returns false when Turnstile responds with success=false', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: false,
          'error-codes': ['invalid-input-response']
        })
    });
    await expect(verifier.verify('bad')).resolves.toBe(false);
  });

  it('returns false on non-2xx siteverify HTTP response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.resolve({})
    });
    await expect(verifier.verify('token')).resolves.toBe(false);
  });

  it('fails closed (returns false) on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(verifier.verify('token')).resolves.toBe(false);
  });

  it('bounds the request and fails closed when it is abandoned', async () => {
    // The signal is read after the call, not inside the stub: an assertion
    // that throws inside `fetch` is swallowed by the fail-closed catch.
    let init: RequestInit | undefined;

    mockFetch.mockImplementation((_url: string, options: RequestInit) => {
      init = options;

      return Promise.reject(new DOMException('timed out', 'TimeoutError'));
    });

    await expect(verifier.verify('token')).resolves.toBe(false);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});
