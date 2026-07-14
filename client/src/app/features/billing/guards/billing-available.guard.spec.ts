import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router, type UrlTree } from '@angular/router';
import {
  type ActivatedRouteSnapshot,
  type RouterStateSnapshot
} from '@angular/router';
import { FeatureFlagsStore } from '@features/feature-flags/store/feature-flags.store';
import { billingAvailableGuard } from './billing-available.guard';

describe('billingAvailableGuard', () => {
  const urlTree = {} as UrlTree;
  let flagsMock: {
    load: ReturnType<typeof vi.fn>;
    isEnabled: ReturnType<typeof vi.fn>;
  };
  let routerMock: { createUrlTree: ReturnType<typeof vi.fn> };

  function run(): Promise<boolean | UrlTree> {
    return TestBed.runInInjectionContext(
      () =>
        billingAvailableGuard(
          {} as ActivatedRouteSnapshot,
          {} as RouterStateSnapshot
        ) as Promise<boolean | UrlTree>
    );
  }

  beforeEach(() => {
    flagsMock = {
      load: vi.fn().mockResolvedValue(undefined),
      isEnabled: vi.fn().mockReturnValue(signal(true))
    };
    routerMock = { createUrlTree: vi.fn().mockReturnValue(urlTree) };

    TestBed.configureTestingModule({
      providers: [
        { provide: FeatureFlagsStore, useValue: flagsMock },
        { provide: Router, useValue: routerMock }
      ]
    });
  });

  it('allows activation when the billing flag is enabled', async () => {
    expect(await run()).toBe(true);
  });

  it('redirects home when the billing flag is disabled', async () => {
    flagsMock.isEnabled.mockReturnValue(signal(false));
    expect(await run()).toBe(urlTree);
    expect(routerMock.createUrlTree).toHaveBeenCalledWith(['/']);
  });

  it('awaits the flags load before evaluating', async () => {
    let flagValue = false;
    flagsMock.load.mockImplementation(async () => {
      flagValue = true;
    });
    flagsMock.isEnabled.mockImplementation(() => () => flagValue);
    expect(await run()).toBe(true);
    expect(flagsMock.load).toHaveBeenCalled();
  });
});
