import { ForbiddenException, Logger } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { InternalNetworkGuard } from './internal-network.guard';

function contextWithIp(ip: string | undefined): ExecutionContext {
  const req = { ip, method: 'GET', originalUrl: '/metrics' };
  // @ts-expect-error partial mock: the guard only calls switchToHttp().getRequest()
  return { switchToHttp: () => ({ getRequest: () => req }) };
}

describe('InternalNetworkGuard', () => {
  let guard: InternalNetworkGuard;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    guard = new InternalNetworkGuard();
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    '127.0.0.1',
    '::1',
    '10.0.0.5',
    '172.17.0.2',
    '192.168.1.10',
    '::ffff:172.18.0.3',
    'fc00::1'
  ])('allows internal address %s', (ip) => {
    expect(guard.canActivate(contextWithIp(ip))).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it.each([
    '203.0.113.10',
    '8.8.8.8',
    '2001:4860:4860::8888',
    '::ffff:203.0.113.10'
  ])('rejects public address %s with 403', (ip) => {
    expect(() => guard.canActivate(contextWithIp(ip))).toThrow(
      ForbiddenException
    );
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(ip));
  });

  it('rejects when req.ip is missing', () => {
    expect(() => guard.canActivate(contextWithIp(undefined))).toThrow(
      ForbiddenException
    );
  });

  it('rejects an unparseable address', () => {
    expect(() => guard.canActivate(contextWithIp('not-an-ip'))).toThrow(
      ForbiddenException
    );
  });
});
