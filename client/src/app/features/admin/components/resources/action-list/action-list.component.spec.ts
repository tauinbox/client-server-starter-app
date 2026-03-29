import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { of } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslocoTestingModuleWithLangs } from '../../../../../../test-utils/transloco-testing';

import { ActionListComponent } from './action-list.component';
import { ResourcesStore } from '../../../store/resources.store';
import { AuthStore } from '@features/auth/store/auth.store';
import type { ActionResponse } from '@app/shared/types/rbac.types';

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

describe('ActionListComponent', () => {
  let component: ActionListComponent;
  let fixture: ComponentFixture<ActionListComponent>;
  let resourcesStoreMock: {
    loading: ReturnType<typeof signal<boolean>>;
    actions: ReturnType<typeof signal<ActionResponse[]>>;
    load: ReturnType<typeof vi.fn>;
    createAction: ReturnType<typeof vi.fn>;
    updateAction: ReturnType<typeof vi.fn>;
    deleteAction: ReturnType<typeof vi.fn>;
  };
  let authStoreMock: { hasPermissions: ReturnType<typeof vi.fn> };
  let dialogMock: { open: ReturnType<typeof vi.fn> };
  let snackBarMock: { open: ReturnType<typeof vi.fn> };

  async function setupComponent(): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [ActionListComponent, TranslocoTestingModuleWithLangs],
      providers: [
        provideNoopAnimations(),
        { provide: ResourcesStore, useValue: resourcesStoreMock },
        { provide: AuthStore, useValue: authStoreMock },
        { provide: MatDialog, useValue: dialogMock },
        { provide: MatSnackBar, useValue: snackBarMock }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ActionListComponent);
    component = fixture.componentInstance;
  }

  beforeEach(() => {
    resourcesStoreMock = {
      loading: signal(false),
      actions: signal([mockAction]),
      load: vi.fn(),
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
    resourcesStoreMock.actions = signal([]);
    await setupComponent();
    fixture.detectChanges();

    const spinner = fixture.nativeElement.querySelector('mat-spinner');
    expect(spinner).toBeTruthy();
  });

  it('shows actions table when not loading', async () => {
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
    it('hides Add Action button when canCreate is false', async () => {
      authStoreMock.hasPermissions.mockReturnValue(false);
      await setupComponent();
      fixture.detectChanges();

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
        'button[aria-label^="Edit Action"]'
      );
      expect(editBtns.length).toBe(0);
    });

    it('shows Edit Action button when canUpdate is true', async () => {
      authStoreMock.hasPermissions.mockReturnValue(true);
      await setupComponent();
      fixture.detectChanges();

      const editBtns = fixture.nativeElement.querySelectorAll(
        'button[aria-label^="Edit Action"]'
      );
      expect(editBtns.length).toBeGreaterThan(0);
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
    it('opens ActionFormDialog (create mode) on add action click', async () => {
      await setupComponent();
      fixture.detectChanges();

      component.openAddAction();

      expect(dialogMock.open).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ data: {} })
      );
    });

    it('opens ActionFormDialog (edit mode) on edit action click', async () => {
      await setupComponent();
      fixture.detectChanges();

      component.openEditAction(mockAction);

      expect(dialogMock.open).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ data: { action: mockAction } })
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
