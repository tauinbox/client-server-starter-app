import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import type {
  ActiveSessionResponse,
  RoleResponse,
  UserResponse
} from '@app/shared/types';
import { TranslocoTestingModuleWithLangs } from '../../../../../test-utils/transloco-testing';
import { NotifyService } from '@core/services/notify.service';
import { AuthService } from '../../services/auth.service';
import type { SessionRevokeTarget } from '../../models/auth.types';
import { ActiveSessionsComponent } from './active-sessions.component';

const mockRole: RoleResponse = {
  id: 'role-user',
  name: 'user',
  description: 'Regular user',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z'
};

function buildUser(overrides: Partial<UserResponse> = {}): UserResponse {
  return {
    id: '1',
    email: 'test@example.com',
    firstName: 'Test',
    lastName: 'User',
    isActive: true,
    roles: [mockRole],
    isEmailVerified: true,
    hasPassword: true,
    mfaEnabled: false,
    locale: 'en',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    deletedAt: null,
    ...overrides
  };
}

const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const SESSIONS: ActiveSessionResponse[] = [
  {
    id: 'current-id',
    current: true,
    userAgent: CHROME_WINDOWS,
    startedAt: '2026-09-01T10:00:00.000Z',
    lastActiveAt: '2026-09-20T10:00:00.000Z'
  },
  {
    id: 'other-id',
    current: false,
    userAgent: '<img src=x onerror=alert(1)>',
    startedAt: '2026-09-02T10:00:00.000Z',
    lastActiveAt: '2026-09-19T10:00:00.000Z'
  },
  {
    id: 'legacy-id',
    current: false,
    userAgent: null,
    startedAt: '2026-09-03T10:00:00.000Z',
    lastActiveAt: '2026-09-18T10:00:00.000Z'
  }
];

describe('ActiveSessionsComponent', () => {
  let fixture: ComponentFixture<ActiveSessionsComponent>;
  let component: ActiveSessionsComponent;
  let authServiceMock: {
    getSessions: ReturnType<typeof vi.fn>;
    revokeSession: ReturnType<typeof vi.fn>;
    revokeOtherSessions: ReturnType<typeof vi.fn>;
  };
  let notifyMock: {
    success: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

  async function create(
    user: UserResponse = buildUser(),
    inputs: Record<string, unknown> = {}
  ): Promise<HTMLElement> {
    fixture = TestBed.createComponent(ActiveSessionsComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('user', user);
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function buttonNamed(host: HTMLElement, label: string): HTMLButtonElement {
    const button = Array.from(host.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === label
    );
    if (!button) throw new Error(`no button "${label}"`);
    return button;
  }

  beforeEach(async () => {
    authServiceMock = {
      getSessions: vi.fn().mockReturnValue(of(SESSIONS)),
      revokeSession: vi.fn().mockReturnValue(of({ message: 'ok' })),
      revokeOtherSessions: vi
        .fn()
        .mockReturnValue(of({ message: 'ok', count: 2 }))
    };
    notifyMock = { success: vi.fn(), error: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [ActiveSessionsComponent, TranslocoTestingModuleWithLangs],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        { provide: AuthService, useValue: authServiceMock },
        { provide: NotifyService, useValue: notifyMock }
      ]
    }).compileComponents();
  });

  it('lists every device and marks this one', async () => {
    const host = await create();

    const items = host.querySelectorAll('.sessions-item');
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain('Chrome on Windows');
    expect(items[0].querySelector('.sessions-badge')).not.toBeNull();
    expect(items[0].querySelector('button')).toBeNull();
    expect(items[2].textContent).toContain('Unknown device');
  });

  it('renders a user agent as text, never as markup', async () => {
    const host = await create();

    const device = host.querySelectorAll('.sessions-device')[1];
    expect(device.querySelector('img')).toBeNull();
    expect(device.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('ends one device with the password and reloads the list', async () => {
    const host = await create();

    const endButtons = host.querySelectorAll<HTMLButtonElement>(
      '.sessions-item button'
    );
    endButtons[0].click();
    fixture.detectChanges();
    component.passwordModel.set({ currentPassword: 'secret' });
    fixture.detectChanges();
    component.confirm();

    expect(authServiceMock.revokeSession).toHaveBeenCalledWith('other-id', {
      currentPassword: 'secret'
    });
    expect(notifyMock.success).toHaveBeenCalledWith('auth.sessions.endedOne');
    expect(authServiceMock.getSessions).toHaveBeenCalledTimes(2);
  });

  it('ends every other device with a code when the account has no password', async () => {
    const host = await create(
      buildUser({ hasPassword: false, mfaEnabled: true })
    );

    buttonNamed(host, 'Sign out all other devices').click();
    fixture.detectChanges();
    component.codeModel.set({ code: ' 123456 ' });
    fixture.detectChanges();
    component.confirm();

    expect(authServiceMock.revokeOtherSessions).toHaveBeenCalledWith({
      code: '123456'
    });
    expect(notifyMock.success).toHaveBeenCalledWith(
      'auth.sessions.endedOthers'
    );
  });

  it('sends an account with no password and no code to its provider', async () => {
    const host = await create(buildUser({ hasPassword: false }), {
      reauthProviderLabel: 'Google'
    });
    const emitted: SessionRevokeTarget[] = [];
    component.reauthRequested.subscribe((target) => emitted.push(target));

    buttonNamed(host, 'Sign out all other devices').click();

    expect(emitted).toEqual([{ scope: 'others' }]);
    expect(authServiceMock.revokeOtherSessions).not.toHaveBeenCalled();
  });

  it('sends the resumed change once, with no factor, after the round trip', async () => {
    await create(buildUser({ hasPassword: false }), {
      reauthProviderLabel: 'Google',
      resumeRevoke: { scope: 'one', sessionId: 'other-id' }
    });

    fixture.componentRef.setInput('resumeRevoke', {
      scope: 'one',
      sessionId: 'other-id'
    });
    fixture.detectChanges();

    expect(authServiceMock.revokeSession).toHaveBeenCalledTimes(1);
    expect(authServiceMock.revokeSession).toHaveBeenCalledWith('other-id', {});
  });

  it('offers to end the others after a sign-in method changed', async () => {
    const host = await create(buildUser(), { offerSignOutOthers: true });

    expect(host.querySelector('.sessions-offer')).not.toBeNull();
  });

  it('shows no offer when no other device is signed in', async () => {
    authServiceMock.getSessions.mockReturnValue(of([SESSIONS[0]]));
    const host = await create(buildUser(), { offerSignOutOthers: true });

    expect(host.querySelector('.sessions-offer')).toBeNull();
    expect(host.textContent).not.toContain('Sign out all other devices');
  });

  it('keeps the prompt open and reports a refused step-up', async () => {
    authServiceMock.revokeSession.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 400 }))
    );
    const host = await create();

    host
      .querySelectorAll<HTMLButtonElement>('.sessions-item button')[0]
      .click();
    component.passwordModel.set({ currentPassword: 'wrong' });
    fixture.detectChanges();
    component.confirm();
    fixture.detectChanges();

    expect(notifyMock.error).toHaveBeenCalledWith(
      expect.any(HttpErrorResponse),
      'auth.sessions.errorEndFailed'
    );
    expect(host.querySelector('.sessions-step-up')).not.toBeNull();
  });
});
