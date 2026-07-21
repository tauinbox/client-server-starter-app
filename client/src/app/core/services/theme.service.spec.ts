import { createEnvironmentInjector, EnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { ThemeService } from './theme.service';

describe('ThemeService', () => {
  let service: ThemeService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    service = TestBed.inject(ThemeService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should ignore a stored theme outside the allowed modes', () => {
    localStorage.setItem('preferred-theme', 'javascript:alert(1)');

    const child = createEnvironmentInjector(
      [ThemeService],
      TestBed.inject(EnvironmentInjector)
    );

    expect(child.get(ThemeService).theme()).toBe('light');
    child.destroy();
  });

  it('should restore a valid stored theme', () => {
    localStorage.setItem('preferred-theme', 'dark');

    const child = createEnvironmentInjector(
      [ThemeService],
      TestBed.inject(EnvironmentInjector)
    );

    expect(child.get(ThemeService).theme()).toBe('dark');
    child.destroy();
  });

  it('should remove matchMedia listener when destroyed', () => {
    const mql = {
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      onchange: null,
      dispatchEvent: (): boolean => false
    };

    // @ts-expect-error testing mock
    const matchMediaSpy = vi.spyOn(window, 'matchMedia').mockReturnValue(mql);

    const child = createEnvironmentInjector(
      [ThemeService],
      TestBed.inject(EnvironmentInjector)
    );

    child.get(ThemeService);
    expect(mql.addEventListener).toHaveBeenCalledWith(
      'change',
      expect.any(Function)
    );

    child.destroy();
    expect(mql.removeEventListener).toHaveBeenCalledWith(
      'change',
      expect.any(Function)
    );

    matchMediaSpy.mockRestore();
  });
});
