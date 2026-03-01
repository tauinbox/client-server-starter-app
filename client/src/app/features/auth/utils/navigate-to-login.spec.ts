import { navigateToLogin } from './navigate-to-login';

describe('navigateToLogin', () => {
  let router: { navigate: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    router = { navigate: vi.fn() };
  });

  it('should navigate to login with returnUrl query param', () => {
    // @ts-expect-error testing mock
    navigateToLogin(router, '/dashboard');

    expect(router.navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: '/dashboard' }
    });
  });

  it('should navigate to login with root returnUrl', () => {
    // @ts-expect-error testing mock
    navigateToLogin(router, '/');

    expect(router.navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: '/' }
    });
  });
});
