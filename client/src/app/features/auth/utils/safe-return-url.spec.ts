import { safeReturnUrl } from './safe-return-url';

const origin = 'http://localhost:4200';

describe('safeReturnUrl', () => {
  it('should return app-internal paths normalised', () => {
    expect(safeReturnUrl('/', origin)).toBe('/');
    expect(safeReturnUrl('/admin/users', origin)).toBe('/admin/users');
    expect(safeReturnUrl('/users?page=2#top', origin)).toBe(
      '/users?page=2#top'
    );
  });

  it('should accept internal paths that carry a double slash in the query or fragment', () => {
    expect(safeReturnUrl('/admin/users?q=a//b', origin)).toBe(
      '/admin/users?q=a//b'
    );
    expect(safeReturnUrl('/a#x//y', origin)).toBe('/a#x//y');
  });

  it('should reject a backslash authority that resolves off-origin', () => {
    expect(safeReturnUrl('/\\evil.example', origin)).toBeNull();
  });

  it('should reject protocol-relative, absolute and non-http URLs', () => {
    expect(safeReturnUrl('//evil.example', origin)).toBeNull();
    expect(safeReturnUrl('https://evil.example/x', origin)).toBeNull();
    expect(safeReturnUrl('javascript:alert(1)', origin)).toBeNull();
  });

  it('should accept an absolute URL on the app origin', () => {
    expect(safeReturnUrl(`${origin}/admin/users`, origin)).toBe('/admin/users');
  });

  it('should resolve a bare relative path against the origin root', () => {
    expect(safeReturnUrl('admin', origin)).toBe('/admin');
  });

  it('should reject empty values and non-strings', () => {
    expect(safeReturnUrl('', origin)).toBeNull();
    expect(safeReturnUrl(undefined, origin)).toBeNull();
    expect(safeReturnUrl(null, origin)).toBeNull();
    expect(safeReturnUrl(42, origin)).toBeNull();
  });

  it('should fail closed when the origin is missing or unusable', () => {
    expect(safeReturnUrl('/admin/users', undefined)).toBeNull();
    expect(safeReturnUrl('/admin/users', null)).toBeNull();
    expect(safeReturnUrl('/admin/users', '')).toBeNull();
    expect(safeReturnUrl('/admin/users', 'not-an-origin')).toBeNull();
  });
});
