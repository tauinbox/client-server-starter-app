import { TestBed } from '@angular/core/testing';
import { NotifyService } from '@core/services/notify.service';
import { RoleService } from '../services/role.service';
import { RolesStore } from './roles.store';

describe('RolesStore', () => {
  it('declares each store member once', () => {
    TestBed.configureTestingModule({
      providers: [
        RolesStore,
        { provide: RoleService, useValue: {} },
        { provide: NotifyService, useValue: {} }
      ]
    });
    const warn = vi.spyOn(console, 'warn').mockReturnValue(undefined);
    TestBed.inject(RolesStore);
    expect(warn.mock.calls.flat().join(' ')).not.toContain(
      'cannot be overridden'
    );
    warn.mockRestore();
  });
});
