import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { of } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';

import { ResourceListComponent } from './resource-list.component';
import { ResourcesStore } from '../../../store/resources.store';
import { AuthStore } from '@features/auth/store/auth.store';
import type {
  ResourceResponse,
  ActionResponse
} from '@app/shared/types/rbac.types';

const mockResource: ResourceResponse = {
  id: 'res-1',
  name: 'user',
  subject: 'User',
  displayName: 'Users',
  description: 'User management',
  isSystem: true,
  isOrphaned: false,
  allowedActionNames: null,
  createdAt: '2024-01-01T00:00:00.000Z'
};

const mockAction: ActionResponse = {
  id: 'act-1',
  name: 'read',
  displayName: 'Read',
  description: 'Read access',
  isDefault: false,
  createdAt: '2024-01-01T00:00:00.000Z'
};

describe('ResourceListComponent', () => {
  let component: ResourceListComponent;
  let fixture: ComponentFixture<ResourceListComponent>;
  let resourcesStoreMock: {
    loading: ReturnType<typeof signal<boolean>>;
    resources: ReturnType<typeof signal<ResourceResponse[]>>;
    actions: ReturnType<typeof signal<ActionResponse[]>>;
    load: ReturnType<typeof vi.fn>;
    updateResource: ReturnType<typeof vi.fn>;
    restoreResource: ReturnType<typeof vi.fn>;
  };
  let authStoreMock: { hasPermissions: ReturnType<typeof vi.fn> };
  let dialogMock: { open: ReturnType<typeof vi.fn> };
  let snackBarMock: { open: ReturnType<typeof vi.fn> };

  async function setupComponent(): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [ResourceListComponent],
      providers: [
        provideNoopAnimations(),
        { provide: ResourcesStore, useValue: resourcesStoreMock },
        { provide: AuthStore, useValue: authStoreMock },
        { provide: MatDialog, useValue: dialogMock },
        { provide: MatSnackBar, useValue: snackBarMock }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ResourceListComponent);
    component = fixture.componentInstance;
  }

  beforeEach(() => {
    resourcesStoreMock = {
      loading: signal(false),
      resources: signal([mockResource]),
      actions: signal([mockAction]),
      load: vi.fn(),
      updateResource: vi.fn().mockReturnValue(of({} as ResourceResponse)),
      restoreResource: vi.fn().mockReturnValue(of({} as ResourceResponse))
    };

    authStoreMock = { hasPermissions: vi.fn().mockReturnValue(false) };
    dialogMock = { open: vi.fn() };
    snackBarMock = { open: vi.fn() };
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('calls store.load() on init', async () => {
    await setupComponent();
    fixture.detectChanges();
    expect(resourcesStoreMock.load).toHaveBeenCalled();
  });

  it('shows spinner when loading', async () => {
    resourcesStoreMock.loading = signal(true);
    resourcesStoreMock.resources = signal([]);
    await setupComponent();
    fixture.detectChanges();

    const spinner = fixture.nativeElement.querySelector('mat-spinner');
    expect(spinner).toBeTruthy();
  });

  it('shows resources table when not loading', async () => {
    await setupComponent();
    fixture.detectChanges();

    const tables = fixture.nativeElement.querySelectorAll('table[mat-table]');
    expect(tables.length).toBe(1);
  });

  it('does not show spinner when not loading', async () => {
    await setupComponent();
    fixture.detectChanges();

    const spinner = fixture.nativeElement.querySelector('mat-spinner');
    expect(spinner).toBeNull();
  });

  describe('permission-based rendering', () => {
    it('hides Edit Resource button when canUpdate is false', async () => {
      authStoreMock.hasPermissions.mockReturnValue(false);
      await setupComponent();
      fixture.detectChanges();

      const editBtns = fixture.nativeElement.querySelectorAll(
        'button[aria-label^="Edit resource"]'
      );
      expect(editBtns.length).toBe(0);
    });

    it('shows Edit Resource button when canUpdate is true', async () => {
      authStoreMock.hasPermissions.mockReturnValue(true);
      await setupComponent();
      fixture.detectChanges();

      const editBtns = fixture.nativeElement.querySelectorAll(
        'button[aria-label^="Edit resource"]'
      );
      expect(editBtns.length).toBeGreaterThan(0);
    });
  });

  describe('dialog interactions', () => {
    it('opens ResourceFormDialog on edit resource click', async () => {
      authStoreMock.hasPermissions.mockReturnValue(true);
      const dialogRefMock = {
        afterClosed: vi.fn().mockReturnValue(of(undefined))
      };
      dialogMock.open.mockReturnValue(dialogRefMock);

      await setupComponent();
      fixture.detectChanges();

      component.openEditResource(mockResource);

      expect(dialogMock.open).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          data: { resource: mockResource, actions: [mockAction] }
        })
      );
    });

    it('calls store.updateResource when ResourceFormDialog returns a result', async () => {
      authStoreMock.hasPermissions.mockReturnValue(true);
      const dialogResult = { displayName: 'New Name', description: null };
      const dialogRefMock = {
        afterClosed: vi.fn().mockReturnValue(of(dialogResult))
      };
      dialogMock.open.mockReturnValue(dialogRefMock);

      await setupComponent();
      fixture.detectChanges();

      component.openEditResource(mockResource);

      expect(resourcesStoreMock.updateResource).toHaveBeenCalledWith(
        'res-1',
        dialogResult
      );
    });
  });
});
