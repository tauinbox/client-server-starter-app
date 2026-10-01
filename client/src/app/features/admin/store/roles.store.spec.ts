import { TestBed } from '@angular/core/testing';
import { NotifyService } from '@core/services/notify.service';
import { storeOverrideWarnings } from '../../../../test-utils/store-override-warnings';
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
    expect(storeOverrideWarnings(() => TestBed.inject(RolesStore))).toEqual([]);
  });
});
