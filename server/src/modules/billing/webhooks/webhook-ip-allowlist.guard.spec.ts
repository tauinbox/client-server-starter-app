import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { WebhookIpAllowlistGuard } from './webhook-ip-allowlist.guard';

function makeGuard(allowlist: string | undefined): WebhookIpAllowlistGuard {
  const config = { get: () => allowlist };
  // @ts-expect-error partial mock: the guard only calls config.get
  return new WebhookIpAllowlistGuard(config);
}

function makeContext(ip: string | undefined): ExecutionContext {
  const req = {
    ip,
    method: 'POST',
    originalUrl: '/api/v1/billing/webhooks/yookassa'
  };
  // @ts-expect-error partial mock: the guard only calls switchToHttp().getRequest()
  return { switchToHttp: () => ({ getRequest: () => req }) };
}

describe('WebhookIpAllowlistGuard', () => {
  it('allows everything when the allowlist is unset or empty', () => {
    expect(makeGuard(undefined).canActivate(makeContext('198.51.100.7'))).toBe(
      true
    );
    expect(makeGuard('').canActivate(makeContext('198.51.100.7'))).toBe(true);
    expect(makeGuard(' , ').canActivate(makeContext('198.51.100.7'))).toBe(
      true
    );
  });

  it('allows an exact IPv4 entry and rejects a neighbour', () => {
    const guard = makeGuard('77.75.156.11,77.75.156.35');
    expect(guard.canActivate(makeContext('77.75.156.11'))).toBe(true);
    expect(() => guard.canActivate(makeContext('77.75.156.12'))).toThrow(
      ForbiddenException
    );
  });

  it('matches IPv4 CIDR boundaries', () => {
    const guard = makeGuard('185.71.76.0/27');
    expect(guard.canActivate(makeContext('185.71.76.31'))).toBe(true);
    expect(() => guard.canActivate(makeContext('185.71.76.32'))).toThrow(
      ForbiddenException
    );
  });

  it('matches an IPv6 CIDR block', () => {
    const guard = makeGuard('2a02:5180::/32');
    expect(guard.canActivate(makeContext('2a02:5180::1'))).toBe(true);
    expect(guard.canActivate(makeContext('2a02:5180:ffff::1'))).toBe(true);
    expect(() => guard.canActivate(makeContext('2a02:5181::1'))).toThrow(
      ForbiddenException
    );
  });

  it('matches IPv4-mapped IPv6 client addresses against IPv4 entries', () => {
    const guard = makeGuard('185.71.76.0/27');
    expect(guard.canActivate(makeContext('::ffff:185.71.76.5'))).toBe(true);
    expect(() => guard.canActivate(makeContext('::ffff:185.71.76.32'))).toThrow(
      ForbiddenException
    );
  });

  it('rejects an address family with no matching entries without throwing a parse error', () => {
    const guard = makeGuard('2a02:5180::/32');
    expect(() => guard.canActivate(makeContext('185.71.76.5'))).toThrow(
      ForbiddenException
    );
  });

  it('rejects a missing or unparseable client address', () => {
    const guard = makeGuard('185.71.76.0/27');
    expect(() => guard.canActivate(makeContext(undefined))).toThrow(
      ForbiddenException
    );
    expect(() => guard.canActivate(makeContext('not-an-ip'))).toThrow(
      ForbiddenException
    );
  });

  it('throws at construction on a malformed entry, naming it', () => {
    expect(() => makeGuard('185.71.76.0/27,oops')).toThrow(
      'Invalid BILLING_WEBHOOK_IP_ALLOWLIST entry "oops"'
    );
    expect(() => makeGuard('185.71.76.0/99')).toThrow(
      'Invalid BILLING_WEBHOOK_IP_ALLOWLIST entry "185.71.76.0/99"'
    );
  });
});
