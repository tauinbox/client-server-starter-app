import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { UserSearchComponent } from './user-search.component';
import { UsersStore } from '../../store/users.store';

describe('UserSearchComponent', () => {
  let component: UserSearchComponent;
  let fixture: ComponentFixture<UserSearchComponent>;
  let usersStore: InstanceType<typeof UsersStore>;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(async () => {
    class MockIntersectionObserver {
      observe = vi.fn();
      disconnect = vi.fn();
    }
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
    await TestBed.configureTestingModule({
      imports: [UserSearchComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        UsersStore
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(UserSearchComponent);
    component = fixture.componentInstance;
    usersStore = TestBed.inject(UsersStore);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('search criteria building', () => {
    let searchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      searchSpy = vi.spyOn(usersStore, 'search').mockImplementation(vi.fn());
    });

    it('should pass isActive=true when Status is "Active"', () => {
      component.searchForm.patchValue({ isActive: 'true' });
      component.onSubmit();

      expect(searchSpy).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: true })
      );
    });

    it('should pass isActive=false when Status is "Inactive"', () => {
      component.searchForm.patchValue({ isActive: 'false' });
      component.onSubmit();

      expect(searchSpy).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: false })
      );
    });

    it('should exclude isActive when Status is "All"', () => {
      component.searchForm.patchValue({ isActive: '' });
      component.onSubmit();

      expect(searchSpy).toHaveBeenCalledWith(
        expect.not.objectContaining({ isActive: expect.anything() })
      );
    });
  });
});
