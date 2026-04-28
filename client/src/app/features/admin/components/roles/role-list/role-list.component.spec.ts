import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { of } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslocoTestingModuleWithLangs } from '../../../../../../test-utils/transloco-testing';
import type { RoleAdminResponse } from '@app/shared/types/role.types';
import { AuthStore } from '@features/auth/store/auth.store';
import { RolesStore } from '../../../store/roles.store';
import { RoleListComponent } from './role-list.component';
import { RolePermissionsDialogComponent } from '../role-permissions-dialog/role-permissions-dialog.component';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const mockRole: RoleAdminResponse = {
  id: 'role-1',
  name: 'Editor',
  description: null,
  isSystem: false,
  isSuper: false,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z'
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('RoleListComponent — openPermissionsDialog', () => {
  let authStoreMock: { hasPermissions: ReturnType<typeof vi.fn> };
  let rolesStoreMock: {
    entities: ReturnType<typeof signal<RoleAdminResponse[]>>;
    loading: ReturnType<typeof signal<boolean>>;
    load: ReturnType<typeof vi.fn>;
    createRole: ReturnType<typeof vi.fn>;
    updateRole: ReturnType<typeof vi.fn>;
    deleteRole: ReturnType<typeof vi.fn>;
  };
  let dialogMock: { open: ReturnType<typeof vi.fn> };
  let snackBarMock: { open: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    rolesStoreMock = {
      entities: signal([]),
      loading: signal(false),
      load: vi.fn(),
      createRole: vi.fn(),
      updateRole: vi.fn(),
      deleteRole: vi.fn()
    };

    authStoreMock = { hasPermissions: vi.fn().mockReturnValue(false) };

    dialogMock = {
      open: vi.fn().mockReturnValue({
        afterClosed: vi.fn().mockReturnValue(of(undefined))
      })
    };

    snackBarMock = { open: vi.fn() };
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  async function setupComponent(): Promise<RoleListComponent> {
    await TestBed.configureTestingModule({
      imports: [RoleListComponent, TranslocoTestingModuleWithLangs],
      providers: [
        provideNoopAnimations(),
        { provide: RolesStore, useValue: rolesStoreMock },
        { provide: AuthStore, useValue: authStoreMock },
        { provide: MatDialog, useValue: dialogMock },
        { provide: MatSnackBar, useValue: snackBarMock }
      ]
    }).compileComponents();

    const fixture = TestBed.createComponent(RoleListComponent);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  it('opens RolePermissionsDialog with readonly: false when canUpdate() is true', async () => {
    authStoreMock.hasPermissions.mockReturnValue(true);

    const component = await setupComponent();
    component.openPermissionsDialog(mockRole);

    expect(dialogMock.open).toHaveBeenCalledWith(
      RolePermissionsDialogComponent,
      expect.objectContaining({
        data: { role: mockRole, readonly: false }
      })
    );
  });

  it('opens RolePermissionsDialog with readonly: true when canUpdate() is false', async () => {
    authStoreMock.hasPermissions.mockReturnValue(false);

    const component = await setupComponent();
    component.openPermissionsDialog(mockRole);

    expect(dialogMock.open).toHaveBeenCalledWith(
      RolePermissionsDialogComponent,
      expect.objectContaining({
        data: { role: mockRole, readonly: true }
      })
    );
  });
});
