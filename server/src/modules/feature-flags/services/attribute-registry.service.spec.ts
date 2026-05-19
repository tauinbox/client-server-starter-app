import { AttributeRegistryService } from './attribute-registry.service';
import type { Request } from 'express';

describe('AttributeRegistryService', () => {
  let service: AttributeRegistryService;
  const fakeReq = {} as Request;

  beforeEach(() => {
    service = new AttributeRegistryService();
  });

  it('resolves built-in email and emailDomain from user', () => {
    const out = service.resolveAll(
      { userId: 'u1', email: 'alice@acme.org', createdAt: new Date(0) },
      fakeReq
    );
    expect(out['email']).toBe('alice@acme.org');
    expect(out['emailDomain']).toBe('acme.org');
    expect(out['createdAt']).toEqual(new Date(0));
  });

  it('omits keys whose resolver returns undefined', () => {
    const out = service.resolveAll(
      { userId: 'u1', email: null, createdAt: null },
      fakeReq
    );
    expect('email' in out).toBe(false);
    expect('createdAt' in out).toBe(false);
    expect('emailDomain' in out).toBe(false);
  });

  it('registerAttribute exposes a custom key', () => {
    service.registerAttribute('tier', () => 'gold');
    expect(service.getKnownCustomKeys().has('tier')).toBe(true);
    const out = service.resolveAll(
      { userId: 'u1', email: null, createdAt: null },
      fakeReq
    );
    expect(out['tier']).toBe('gold');
  });

  it('built-in keys are excluded from getKnownCustomKeys', () => {
    const customs = service.getKnownCustomKeys();
    expect(customs.has('email')).toBe(false);
    expect(customs.has('emailDomain')).toBe(false);
    expect(customs.has('createdAt')).toBe(false);
  });

  it('a throwing resolver does not break resolveAll', () => {
    service.registerAttribute('boom', () => {
      throw new Error('nope');
    });
    expect(() =>
      service.resolveAll(
        { userId: 'u1', email: 'a@b.com', createdAt: null },
        fakeReq
      )
    ).not.toThrow();
  });

  it('emailDomain returns undefined for malformed email', () => {
    const out = service.resolveAll(
      { userId: 'u1', email: 'no-at-sign', createdAt: null },
      fakeReq
    );
    expect(out['email']).toBe('no-at-sign');
    expect('emailDomain' in out).toBe(false);
  });
});
