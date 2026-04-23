import { extractAuditContext } from './audit-context.util';

describe('extractAuditContext', () => {
  it('uses req.ip verbatim (downstream of Express trust-proxy handling)', () => {
    const ctx = extractAuditContext({
      ip: '203.0.113.7',
      headers: { 'x-request-id': 'abc-123' }
    });

    expect(ctx.ip).toBe('203.0.113.7');
    expect(ctx.requestId).toBe('abc-123');
  });

  it('passes undefined ip through — never reads proxy headers directly', () => {
    const ctx = extractAuditContext({
      ip: undefined,
      // An attacker-controlled X-Forwarded-For MUST NOT leak into the audit
      // context: only Express's resolved req.ip (governed by trust proxy) is
      // consulted.
      headers: { 'x-forwarded-for': '1.2.3.4' }
    });

    expect(ctx.ip).toBeUndefined();
    expect(ctx.requestId).toBeUndefined();
  });

  it('reads x-request-id header when present', () => {
    const ctx = extractAuditContext({
      ip: '127.0.0.1',
      headers: { 'x-request-id': 'req-42' }
    });

    expect(ctx.requestId).toBe('req-42');
  });
});
