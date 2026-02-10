import { HttpErrorResponse } from '@angular/common/http';
import { shouldAttemptTokenRefresh } from './should-attempt-token-refresh';

describe('shouldAttemptTokenRefresh', () => {
  it('should return true for 401 error on non-excluded URL', () => {
    const error = new HttpErrorResponse({ status: 401 });
    expect(shouldAttemptTokenRefresh(error, false)).toBe(true);
  });

  it('should return false for 401 error on excluded URL', () => {
    const error = new HttpErrorResponse({ status: 401 });
    expect(shouldAttemptTokenRefresh(error, true)).toBe(false);
  });

  it('should return false for 403 error on non-excluded URL', () => {
    const error = new HttpErrorResponse({ status: 403 });
    expect(shouldAttemptTokenRefresh(error, false)).toBe(false);
  });

  it('should return false for 500 error on non-excluded URL', () => {
    const error = new HttpErrorResponse({ status: 500 });
    expect(shouldAttemptTokenRefresh(error, false)).toBe(false);
  });

  it('should return false for 0 (network error) on non-excluded URL', () => {
    const error = new HttpErrorResponse({ status: 0 });
    expect(shouldAttemptTokenRefresh(error, false)).toBe(false);
  });
});
