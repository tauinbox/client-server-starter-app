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

const mockDefaultAction: ActionResponse = {
  id: 'act-default',
  name: 'create',
  displayName: 'Create',
  description: 'Create access',
  isDefault: true,
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
    createAction: ReturnType<typeof vi.fn>;
    updateAction: ReturnType<typeof vi.fn>;
    deleteAction: ReturnType<typeof vi.fn>;
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
      createAction: vi.fn().mockReturnValue(of({} as ActionResponse)),
      updateAction: vi.fn().mockReturnValue(of({} as ActionResponse)),
      deleteAction: vi.fn().mockReturnValue(of(undefined))
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
    await setupComponent();
    fixture.detectChanges();

    const spinner = fixture.nativeElement.querySelector('mat-spinner');
    expect(spinner).toBeTruthy();
  });

  it('shows resources and actions tables when not loading', async () => {
    await setupComponent();
    fixture.detectChanges();

    const tables = fixture.nativeElement.querySelectorAll('table[mat-table]');
    expect(tables.length).toBe(2);
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

    it('hides Add Action button when canCreate is false', async () => {
      authStoreMock.hasPermissions.mockReturnValue(false);
      await setupComponent();
      fixture.detectChanges();

      const addBtn = fixture.nativeElement.querySelector(
        'button[color="primary"]'
      );
      // "Add Action" button text check
      const allBtns = Array.from<HTMLButtonElement>(
        fixture.nativeElement.querySelectorAll('button')
      );
      const addActionBtn = allBtns.find((b) =>
        b.textContent?.includes('Add Action')
      );
      expect(addActionBtn).toBeUndefined();
    });

    it('shows Add Action button when canCreate is true', async () => {
      authStoreMock.hasPermissions.mockReturnValue(true);
      await setupComponent();
      fixture.detectChanges();

      const allBtns = Array.from<HTMLButtonElement>(
        fixture.nativeElement.querySelectorAll('button')
      );
      const addActionBtn = allBtns.find((b) =>
        b.textContent?.includes('Add Action')
      );
      expect(addActionBtn).toBeTruthy();
    });

    it('hides Edit Action button when canUpdate is false', async () => {
      authStoreMock.hasPermissions.mockReturnValue(false);
      await setupComponent();
      fixture.detectChanges();

      const editBtns = fixture.nativeElement.querySelectorAll(
        'button[aria-label^="Edit action"]'
      );
      expect(editBtns.length).toBe(0);
    });

    it('hides Delete Action button when canDelete is false', async () => {
      authStoreMock.hasPermissions.mockReturnValue(false);
      await setupComponent();
      fixture.detectChanges();

      const deleteBtns = fixture.nativeElement.querySelectorAll(
        'button[aria-label^="Delete action"]'
      );
      expect(deleteBtns.length).toBe(0);
    });

    it('hides Delete Action button when action.isDefault is true even with canDelete', async () => {
      resourcesStoreMock.actions = signal([mockDefaultAction]);
      authStoreMock.hasPermissions.mockReturnValue(true);
      await setupComponent();
      fixture.detectChanges();

      const deleteBtns = fixture.nativeElement.querySelectorAll(
        'button[aria-label^="Delete action"]'
      );
      expect(deleteBtns.length).toBe(0);
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
        expect.objectContaining({ data: { resource: mockResource } })
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

    it('opens ActionFormDialog (create mode) on add action click', async () => {
      const dialogRefMock = {
        afterClosed: vi.fn().mockReturnValue(of(undefined))
      };
      dialogMock.open.mockReturnValue(dialogRefMock);

      await setupComponent();
      fixture.detectChanges();

      component.openAddAction();

      expect(dialogMock.open).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ data: {} })
      );
    });

    it('calls store.createAction when ActionFormDialog (add) returns a result', async () => {
      const dialogResult = {
        name: 'publish',
        displayName: 'Publish',
        description: ''
      };
      const dialogRefMock = {
        afterClosed: vi.fn().mockReturnValue(of(dialogResult))
      };
      dialogMock.open.mockReturnValue(dialogRefMock);

      await setupComponent();
      fixture.detectChanges();

      component.openAddAction();

      expect(resourcesStoreMock.createAction).toHaveBeenCalledWith(
        dialogResult
      );
    });

    it('opens ActionFormDialog (edit mode) on edit action click', async () => {
      const dialogRefMock = {
        afterClosed: vi.fn().mockReturnValue(of(undefined))
      };
      dialogMock.open.mockReturnValue(dialogRefMock);

      await setupComponent();
      fixture.detectChanges();

      component.openEditAction(mockAction);

      expect(dialogMock.open).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ data: { action: mockAction } })
      );
    });

    it('calls store.updateAction when ActionFormDialog (edit) returns a result', async () => {
      const dialogResult = {
        name: 'read',
        displayName: 'Read All',
        description: ''
      };
      const dialogRefMock = {
        afterClosed: vi.fn().mockReturnValue(of(dialogResult))
      };
      dialogMock.open.mockReturnValue(dialogRefMock);

      await setupComponent();
      fixture.detectChanges();

      component.openEditAction(mockAction);

      expect(resourcesStoreMock.updateAction).toHaveBeenCalledWith(
        'act-1',
        dialogResult
      );
    });

    it('opens ConfirmDialog on delete action click', async () => {
      const dialogRefMock = { afterClosed: vi.fn().mockReturnValue(of(false)) };
      dialogMock.open.mockReturnValue(dialogRefMock);

      await setupComponent();
      fixture.detectChanges();

      component.confirmDeleteAction(mockAction);

      expect(dialogMock.open).toHaveBeenCalled();
    });

    it('calls store.deleteAction when ConfirmDialog is confirmed', async () => {
      const dialogRefMock = { afterClosed: vi.fn().mockReturnValue(of(true)) };
      dialogMock.open.mockReturnValue(dialogRefMock);

      await setupComponent();
      fixture.detectChanges();

      component.confirmDeleteAction(mockAction);

      expect(resourcesStoreMock.deleteAction).toHaveBeenCalledWith('act-1');
    });

    it('does not call store.deleteAction when ConfirmDialog is cancelled', async () => {
      const dialogRefMock = { afterClosed: vi.fn().mockReturnValue(of(false)) };
      dialogMock.open.mockReturnValue(dialogRefMock);

      await setupComponent();
      fixture.detectChanges();

      component.confirmDeleteAction(mockAction);

      expect(resourcesStoreMock.deleteAction).not.toHaveBeenCalled();
    });
  });
});
