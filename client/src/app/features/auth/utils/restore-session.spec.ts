import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { restoreSession } from './restore-session';
import { AuthService } from '../services/auth.service';
import { AuthStore } from '../store/auth.store';
import { FeatureFlagsStore } from '@features/feature-flags/store/feature-flags.store';
import type { TokensResponse } from '../models/auth.types';

describe('restoreSession', () => {
  let authStoreMock: {
    hasPersistedUser: ReturnType<typeof vi.fn>;
  };
  let authServiceMock: {
    refreshTokens: ReturnType<typeof vi.fn>;
    completeAuthentication: ReturnType<typeof vi.fn>;
    clearSession: ReturnType<typeof vi.fn>;
  };
  let featureFlagsStoreMock: {
    load: ReturnType<typeof vi.fn>;
  };

  const mockTokens: TokensResponse = {
    access_token: 'access',
    expires_in: 3600
  };

  const run = () => TestBed.runInInjectionContext(() => restoreSession());

  beforeEach(() => {
    authStoreMock = { hasPersistedUser: vi.fn().mockReturnValue(true) };
    authServiceMock = {
      refreshTokens: vi.fn().mockReturnValue(of(mockTokens)),
      completeAuthentication: vi.fn().mockResolvedValue(undefined),
      clearSession: vi.fn()
    };
    featureFlagsStoreMock = { load: vi.fn().mockResolvedValue(undefined) };

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthStore, useValue: authStoreMock },
        { provide: AuthService, useValue: authServiceMock },
        { provide: FeatureFlagsStore, useValue: featureFlagsStoreMock }
      ]
    });
  });

  it('refreshes, then starts the session once, after a page reload', async () => {
    await run();

    expect(authServiceMock.refreshTokens).toHaveBeenCalledTimes(1);
    expect(authServiceMock.completeAuthentication).toHaveBeenCalledTimes(1);
    expect(authServiceMock.clearSession).not.toHaveBeenCalled();
    // completeAuthentication reloads the flags itself.
    expect(featureFlagsStoreMock.load).not.toHaveBeenCalled();
  });

  it('clears the session and starts nothing when the refresh fails', async () => {
    authServiceMock.refreshTokens.mockReturnValue(
      throwError(() => new Error('refresh failed'))
    );

    await run();

    expect(authServiceMock.completeAuthentication).not.toHaveBeenCalled();
    expect(authServiceMock.clearSession).toHaveBeenCalledTimes(1);
  });

  it('clears the session when starting it fails', async () => {
    authServiceMock.completeAuthentication.mockRejectedValue(
      new Error('start failed')
    );

    await run();

    expect(authServiceMock.clearSession).toHaveBeenCalledTimes(1);
  });

  it('loads the public flags only, for an anonymous bootstrap', async () => {
    authStoreMock.hasPersistedUser.mockReturnValue(false);

    await run();

    expect(authServiceMock.refreshTokens).not.toHaveBeenCalled();
    expect(authServiceMock.completeAuthentication).not.toHaveBeenCalled();
    expect(featureFlagsStoreMock.load).toHaveBeenCalledTimes(1);
  });
});
