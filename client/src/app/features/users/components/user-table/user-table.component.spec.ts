import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import type { ComponentRef } from '@angular/core';

import { UserTableComponent } from './user-table.component';

describe('UserTableComponent', () => {
  let component: UserTableComponent;
  let componentRef: ComponentRef<UserTableComponent>;
  let fixture: ComponentFixture<UserTableComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UserTableComponent],
      providers: [provideRouter([]), provideNoopAnimations()]
    }).compileComponents();

    fixture = TestBed.createComponent(UserTableComponent);
    component = fixture.componentInstance;
    componentRef = fixture.componentRef;

    componentRef.setInput('users', []);
    componentRef.setInput('totalItems', 0);
    componentRef.setInput('currentPage', 0);
    componentRef.setInput('pageSize', 10);

    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should have all 7 displayed columns', () => {
    expect(component.displayedColumns).toEqual([
      'id',
      'email',
      'name',
      'status',
      'role',
      'createdAt',
      'actions'
    ]);
  });
});
