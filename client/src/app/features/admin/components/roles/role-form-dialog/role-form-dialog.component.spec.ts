import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import type { RoleAdminResponse } from '@app/shared/types';
import { TranslocoTestingModuleWithLangs } from '../../../../../../test-utils/transloco-testing';
import { KeyboardShortcutsService } from '@core/services/keyboard-shortcuts.service';
import { RolesStore } from '../../../store/roles.store';
import type { RoleFormDialogData } from './role-form-dialog.component';
import { RoleFormDialogComponent } from './role-form-dialog.component';

describe('RoleFormDialogComponent', () => {
  const role: RoleAdminResponse = {
    id: 'role-1',
    name: 'editor',
    description: null,
    isSystem: false,
    isSuper: false,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z'
  };

  let closeSpy: ReturnType<typeof vi.fn>;
  let storeMock: {
    createRole: ReturnType<typeof vi.fn>;
    updateRole: ReturnType<typeof vi.fn>;
  };

  async function setup(
    data: RoleFormDialogData
  ): Promise<ComponentFixture<RoleFormDialogComponent>> {
    closeSpy = vi.fn();
    storeMock = {
      createRole: vi.fn((dto: object) => of({ ...role, ...dto, id: 'new' })),
      updateRole: vi.fn((id: string, dto: object) => of({ ...role, ...dto }))
    };
    await TestBed.configureTestingModule({
      imports: [RoleFormDialogComponent, TranslocoTestingModuleWithLangs],
      providers: [
        provideNoopAnimations(),
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close: closeSpy } },
        { provide: RolesStore, useValue: storeMock },
        {
          provide: KeyboardShortcutsService,
          useValue: { registerSave: vi.fn(() => () => undefined) }
        }
      ]
    }).compileComponents();
    const fixture = TestBed.createComponent(RoleFormDialogComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  it('creates the role and closes with the saved role', async () => {
    const fixture = await setup({});
    const cmp = fixture.componentInstance;
    cmp.roleModel.set({ name: ' auditor ', description: '' });
    await fixture.whenStable();

    cmp.submit();

    expect(storeMock.createRole).toHaveBeenCalledExactlyOnceWith({
      name: 'auditor',
      description: null
    });
    expect(closeSpy).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: 'new', name: 'auditor' })
    );
  });

  it('keeps the dialog open with the input and shows the error when the save fails', async () => {
    const fixture = await setup({ role });
    storeMock.updateRole.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: {
              message: 'Role with this name already exists',
              errorKey: 'errors.roles.nameExists'
            }
          })
      )
    );
    const cmp = fixture.componentInstance;
    cmp.roleModel.set({ name: 'moderator', description: 'edits content' });
    await fixture.whenStable();

    cmp.submit();
    fixture.detectChanges();

    expect(storeMock.updateRole).toHaveBeenCalledWith('role-1', {
      name: 'moderator',
      description: 'edits content'
    });
    expect(closeSpy).not.toHaveBeenCalled();
    expect(cmp.roleModel()).toEqual({
      name: 'moderator',
      description: 'edits content'
    });
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.form-error')?.textContent?.trim()).toBe(
      'Role with this name already exists'
    );
    const save = host.querySelector<HTMLButtonElement>(
      'mat-dialog-actions button[matButton="filled"]'
    );
    expect(save?.disabled).toBe(false);
  });

  it('sends nothing when the form is unchanged', async () => {
    const fixture = await setup({ role });

    fixture.componentInstance.submit();

    expect(storeMock.updateRole).not.toHaveBeenCalled();
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it('sends nothing for a system role', async () => {
    const fixture = await setup({ role: { ...role, isSystem: true } });

    fixture.componentInstance.submit();

    expect(storeMock.updateRole).not.toHaveBeenCalled();
  });
});
