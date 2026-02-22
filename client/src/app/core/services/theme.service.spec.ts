import { createEnvironmentInjector, EnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { ThemeService } from './theme.service';

describe('ThemeService', () => {
  let service: ThemeService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ThemeService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
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
    } as unknown as MediaQueryList;

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
