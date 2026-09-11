import { extractAuditContext } from './audit-context.util';

describe('extractAuditContext', () => {
  it('uses req.ip verbatim (downstream of Express trust-proxy handling)', () => {
    const ctx = extractAuditContext({
      ip: '203.0.113.7',
      requestId: 'abc-123'
    });

    expect(ctx.ip).toBe('203.0.113.7');
    expect(ctx.requestId).toBe('abc-123');
  });

  it('passes undefined ip through - never reads proxy headers directly', () => {
    // Only Express's resolved req.ip is consulted, and it is governed by trust
    // proxy. An attacker-controlled X-Forwarded-For never reaches the context.
    const ctx = extractAuditContext({
      ip: undefined,
      requestId: undefined
    });

    expect(ctx.ip).toBeUndefined();
    expect(ctx.requestId).toBeUndefined();
  });

  it('reads the sanitised req.requestId written by RequestIdMiddleware', () => {
    const ctx = extractAuditContext({
      ip: '127.0.0.1',
      requestId: 'req-42'
    });

    expect(ctx.requestId).toBe('req-42');
  });

  it('ignores the raw X-Request-Id header, however long it is', () => {
    // RequestIdMiddleware rejects this header and substitutes a UUID. Reading
    // the header here would put the 5000 characters of the attacker in the row and
    // break correlation with the response header and the request log.
    const req = {
      ip: '203.0.113.7',
      requestId: 'a0f3c2d1-generated',
      headers: { 'x-request-id': 'x'.repeat(5000) }
    };

    const ctx = extractAuditContext(req);

    expect(ctx.requestId).toBe('a0f3c2d1-generated');
  });

  it('returns undefined when no middleware ran (non-HTTP context)', () => {
    const ctx = extractAuditContext({ ip: '127.0.0.1' });

    expect(ctx.requestId).toBeUndefined();
  });
});
