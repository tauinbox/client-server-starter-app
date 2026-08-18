import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { of, Subject, throwError } from 'rxjs';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslocoTestingModuleWithLangs } from '../../../../../../test-utils/transloco-testing';

import { ResourceFormDialogComponent } from './resource-form-dialog.component';
import type { ResourceFormDialogData } from './resource-form-dialog.component';
import { ResourcesStore } from '../../../store/resources.store';
import { RbacAdminService } from '../../../services/rbac-admin.service';
import { NotifyService } from '@core/services/notify.service';
import type { ActionResponse, ResourceResponse } from '@app/shared/types';

const mockResource: ResourceResponse = {
  id: 'res-1',
  name: 'user',
  subject: 'User',
  displayName: 'Users',
  description: 'User management',
  isSystem: true,
  isOrphaned: false,
  isRegistered: true,
  allowedActionNames: null,
  createdAt: '2024-01-01T00:00:00.000Z'
};

const mockActions: ActionResponse[] = [
  {
    id: 'act-1',
    name: 'create',
    displayName: 'Create',
    description: '',
    isDefault: true,
    createdAt: '2024-01-01T00:00:00.000Z'
  },
  {
    id: 'act-2',
    name: 'read',
    displayName: 'Read',
    description: '',
    isDefault: true,
    createdAt: '2024-01-01T00:00:00.000Z'
  },
  {
    id: 'act-3',
    name: 'assign',
    displayName: 'Assign',
    description: '',
    isDefault: false,
    createdAt: '2024-01-01T00:00:00.000Z'
  }
];

describe('ResourceFormDialogComponent', () => {
  let component: ResourceFormDialogComponent;
  let fixture: ComponentFixture<ResourceFormDialogComponent>;
  let dialogRefMock: { close: ReturnType<typeof vi.fn> };
  let resourcesStoreMock: {
    resources: ReturnType<typeof signal<ResourceResponse[]>>;
    loading: ReturnType<typeof signal<boolean>>;
    load: ReturnType<typeof vi.fn>;
    updateResource: ReturnType<typeof vi.fn>;
  };
  let rbacServiceMock: { getActions: ReturnType<typeof vi.fn> };
  let notifyMock: {
    success: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
  };

  function createComponent(
    data: ResourceFormDialogData = { resource: mockResource }
  ): void {
    dialogRefMock = { close: vi.fn() };

    TestBed.configureTestingModule({
      imports: [ResourceFormDialogComponent, TranslocoTestingModuleWithLangs],
      providers: [
        provideNoopAnimations(),
        { provide: MatDialogRef, useValue: dialogRefMock },
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: ResourcesStore, useValue: resourcesStoreMock },
        { provide: RbacAdminService, useValue: rbacServiceMock },
        { provide: NotifyService, useValue: notifyMock }
      ]
    });

    fixture = TestBed.createComponent(ResourceFormDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    resourcesStoreMock = {
      resources: signal([mockResource]),
      loading: signal(false),
      load: vi.fn(),
      updateResource: vi.fn().mockReturnValue(of(mockResource))
    };
    rbacServiceMock = { getActions: vi.fn().mockReturnValue(of(mockActions)) };
    notifyMock = {
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn()
    };
  });

  it('renders "Edit Resource" title', () => {
    createComponent();
    const title = fixture.nativeElement.querySelector('[mat-dialog-title]');
    expect(title?.textContent?.trim()).toBe('Edit Resource');
  });

  it('pre-fills model with resource displayName and description', () => {
    createComponent();
    expect(component.resourceModel().displayName).toBe('Users');
    expect(component.resourceModel().description).toBe('User management');
  });

  it('pre-fills description as empty string when resource description is null', () => {
    createComponent({ resource: { ...mockResource, description: null } });
    expect(component.resourceModel().description).toBe('');
  });

  it('disables Save button when form is pristine', () => {
    createComponent();
    const saveBtn = fixture.nativeElement.querySelector(
      'button[matButton="filled"]'
    );
    expect(saveBtn?.disabled).toBe(true);
  });

  it('enables Save button when model changes and form is valid', () => {
    createComponent();
    component.resourceModel.set({
      displayName: 'Updated Name',
      description: 'User management'
    });
    TestBed.tick();
    fixture.detectChanges();
    const saveBtn = fixture.nativeElement.querySelector(
      'button[matButton="filled"]'
    );
    expect(saveBtn?.disabled).toBe(false);
  });

  it('disables Save button when displayName is empty (required)', () => {
    createComponent();
    component.resourceModel.set({
      displayName: '',
      description: 'User management'
    });
    TestBed.tick();
    fixture.detectChanges();
    const saveBtn = fixture.nativeElement.querySelector(
      'button[matButton="filled"]'
    );
    expect(saveBtn?.disabled).toBe(true);
  });

  it('disables Save button when displayName exceeds 100 chars (maxlength)', () => {
    createComponent();
    component.resourceModel.set({
      displayName: 'a'.repeat(101),
      description: 'User management'
    });
    TestBed.tick();
    fixture.detectChanges();
    const saveBtn = fixture.nativeElement.querySelector(
      'button[matButton="filled"]'
    );
    expect(saveBtn?.disabled).toBe(true);
  });

  it('calls store.updateResource with trimmed values on submit', () => {
    createComponent();
    component.resourceModel.set({
      displayName: '  Updated  ',
      description: '  A desc  '
    });
    TestBed.tick();
    fixture.detectChanges();

    component.submit();

    expect(resourcesStoreMock.updateResource).toHaveBeenCalledWith('res-1', {
      displayName: 'Updated',
      description: 'A desc',
      allowedActionNames: null
    });
    expect(dialogRefMock.close).toHaveBeenCalledWith(true);
  });

  it('passes null description when trimmed value is empty on submit', () => {
    createComponent();
    component.resourceModel.set({
      displayName: 'Name',
      description: '   '
    });
    TestBed.tick();

    component.submit();

    expect(resourcesStoreMock.updateResource).toHaveBeenCalledWith(
      'res-1',
      expect.objectContaining({ description: null })
    );
  });

  it('calls dialogRef.close with no argument on cancel', () => {
    createComponent();
    component.cancel();
    expect(dialogRefMock.close).toHaveBeenCalledWith();
  });

  describe('allowed-actions catalog', () => {
    function customToggle(): HTMLButtonElement {
      return fixture.nativeElement.querySelector('button[role="switch"]');
    }

    it('loads the whole catalog rather than receiving it from the opener', () => {
      createComponent();
      expect(rbacServiceMock.getActions).toHaveBeenCalled();
    });

    it('renders a checkbox for every action in the catalog', () => {
      createComponent({
        resource: { ...mockResource, allowedActionNames: ['create'] }
      });

      const checkboxes = fixture.nativeElement.querySelectorAll('mat-checkbox');
      expect(checkboxes.length).toBe(mockActions.length);
    });

    it('seeds custom mode from every default action in the catalog', () => {
      createComponent();

      customToggle().click();
      fixture.detectChanges();
      component.submit();

      expect(resourcesStoreMock.updateResource).toHaveBeenCalledWith(
        'res-1',
        expect.objectContaining({ allowedActionNames: ['create', 'read'] })
      );
    });

    it('cannot enter custom mode while the catalog is still loading', () => {
      rbacServiceMock.getActions.mockReturnValue(new Subject());
      createComponent();

      expect(customToggle().disabled).toBe(true);

      customToggle().click();
      fixture.detectChanges();

      expect(
        fixture.nativeElement.querySelectorAll('mat-checkbox').length
      ).toBe(0);
    });

    it('keeps the stored action list intact when the catalog fails to load', () => {
      rbacServiceMock.getActions.mockReturnValue(
        throwError(() => new Error('offline'))
      );
      createComponent({
        resource: { ...mockResource, allowedActionNames: ['create', 'read'] }
      });

      component.resourceModel.set({
        displayName: 'Updated',
        description: 'User management'
      });
      TestBed.tick();
      component.submit();

      expect(resourcesStoreMock.updateResource).toHaveBeenCalledWith(
        'res-1',
        expect.objectContaining({ allowedActionNames: ['create', 'read'] })
      );
    });
  });

  it('does not call store.updateResource when form is invalid on submit', () => {
    createComponent();
    component.resourceModel.set({
      displayName: '',
      description: ''
    });
    TestBed.tick();

    component.submit();

    expect(resourcesStoreMock.updateResource).not.toHaveBeenCalled();
    expect(dialogRefMock.close).not.toHaveBeenCalled();
  });
});
