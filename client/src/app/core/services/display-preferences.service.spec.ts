import { TestBed } from '@angular/core/testing';

import { DisplayPreferencesService } from './display-preferences.service';

const STORAGE_KEY = 'display-density';

describe('DisplayPreferencesService', () => {
  const root = document.documentElement;

  const create = (): DisplayPreferencesService =>
    TestBed.inject(DisplayPreferencesService);

  beforeEach(() => {
    localStorage.clear();
    root.removeAttribute('data-ui-density');
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    localStorage.clear();
    root.removeAttribute('data-ui-density');
  });

  it('defaults to level 0 (no density attribute)', () => {
    const service = create();
    TestBed.tick();

    expect(service.density()).toBe(0);
    expect(root.hasAttribute('data-ui-density')).toBe(false);
  });

  it('applies a density level to <html> and persists it', () => {
    const service = create();
    service.setDensity(3);
    TestBed.tick();

    expect(service.density()).toBe(3);
    expect(root.getAttribute('data-ui-density')).toBe('3');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('3');
  });

  it('removes the density attribute when returning to level 0', () => {
    const service = create();
    service.setDensity(2);
    TestBed.tick();
    expect(root.getAttribute('data-ui-density')).toBe('2');

    service.setDensity(0);
    TestBed.tick();
    expect(root.hasAttribute('data-ui-density')).toBe(false);
  });

  it('clamps and rounds out-of-range levels', () => {
    const service = create();

    service.setDensity(99);
    expect(service.density()).toBe(5);

    service.setDensity(-3);
    expect(service.density()).toBe(0);

    service.setDensity(2.6);
    expect(service.density()).toBe(3);
  });

  it('restores a previously saved level on init', () => {
    localStorage.setItem(STORAGE_KEY, '4');

    const service = create();
    TestBed.tick();

    expect(service.density()).toBe(4);
    expect(root.getAttribute('data-ui-density')).toBe('4');
  });

  it('falls back to level 0 for a non-numeric saved value', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify('bogus'));

    const service = create();

    expect(service.density()).toBe(0);
  });
});
