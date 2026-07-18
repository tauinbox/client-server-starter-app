import { HttpRequest } from '@angular/common/http';
import { isSameOriginUrl } from './is-same-origin-url';

const BASE_ORIGIN = 'http://localhost:4200';

describe('isSameOriginUrl', () => {
  it('should return true for a relative URL', () => {
    const request = new HttpRequest('GET', '/api/v1/users');
    expect(isSameOriginUrl(request, BASE_ORIGIN)).toBe(true);
  });

  it('should return true for an absolute same-origin URL', () => {
    const request = new HttpRequest(
      'GET',
      'http://localhost:4200/api/v1/users'
    );
    expect(isSameOriginUrl(request, BASE_ORIGIN)).toBe(true);
  });

  it('should return false for an absolute cross-origin URL', () => {
    const request = new HttpRequest('GET', 'https://evil.example.com/api');
    expect(isSameOriginUrl(request, BASE_ORIGIN)).toBe(false);
  });

  it('should return false for a same-host URL on a different port', () => {
    const request = new HttpRequest('GET', 'http://localhost:3000/api');
    expect(isSameOriginUrl(request, BASE_ORIGIN)).toBe(false);
  });

  it('should return false for a same-host URL on a different scheme', () => {
    const request = new HttpRequest(
      'GET',
      'https://localhost:4200/api/v1/users'
    );
    expect(isSameOriginUrl(request, BASE_ORIGIN)).toBe(false);
  });

  it('should return false when the base origin is empty (fail closed)', () => {
    const request = new HttpRequest('GET', '/api/v1/users');
    expect(isSameOriginUrl(request, '')).toBe(false);
  });
});
