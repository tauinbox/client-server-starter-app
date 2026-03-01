import type { Mock } from 'vitest';
import type { Router } from '@angular/router';
import { navigateToLogin } from './navigate-to-login';

type NavigateMock = Mock<Router['navigate']>;

describe('navigateToLogin', () => {
  let router: { navigate: NavigateMock };

  beforeEach(() => {
    router = {
      navigate: vi.fn<Router['navigate']>()
    };
  });

  it('should navigate to login with returnUrl query param', () => {
    navigateToLogin(router, '/dashboard');

    expect(router.navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: '/dashboard' }
    });
  });

  it('should navigate to login with root returnUrl', () => {
    navigateToLogin(router, '/');

    expect(router.navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: '/' }
    });
  });
});
