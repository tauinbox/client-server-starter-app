import { HttpRequest } from '@angular/common/http';
import { addTokenToRequest } from './add-token-to-request';

describe('addTokenToRequest', () => {
  it('should clone request with Bearer authorization header', () => {
    const request = new HttpRequest('GET', '/api/data');
    const result = addTokenToRequest(request, 'test-token');

    expect(result.headers.get('Authorization')).toBe('Bearer test-token');
  });

  it('should not modify the original request', () => {
    const request = new HttpRequest('GET', '/api/data');
    addTokenToRequest(request, 'test-token');

    expect(request.headers.has('Authorization')).toBe(false);
  });

  it('should preserve the original request URL and method', () => {
    const request = new HttpRequest('POST', '/api/submit', { data: 'test' });
    const result = addTokenToRequest(request, 'my-token');

    expect(result.url).toBe('/api/submit');
    expect(result.method).toBe('POST');
    expect(result.body).toEqual({ data: 'test' });
  });
});
