import { navigateToLogin } from './navigate-to-login';
import type { Router } from '@angular/router';

describe('navigateToLogin', () => {
  let router: { navigate: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    router = { navigate: vi.fn() };
  });

  it('should navigate to login with returnUrl query param', () => {
    navigateToLogin(router as unknown as Router, '/dashboard');

    expect(router.navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: '/dashboard' }
    });
  });

  it('should navigate to login with root returnUrl', () => {
    navigateToLogin(router as unknown as Router, '/');

    expect(router.navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: '/' }
    });
  });
});
