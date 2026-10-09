import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LayoutService } from '@core/services/layout.service';
import { CreateButtonComponent } from './create-button.component';

describe('CreateButtonComponent', () => {
  const isHandset = signal(false);

  beforeEach(() => {
    isHandset.set(false);
    TestBed.configureTestingModule({
      imports: [CreateButtonComponent],
      providers: [{ provide: LayoutService, useValue: { isHandset } }]
    });
  });

  function render(): {
    host: HTMLElement;
    pressed: ReturnType<typeof vi.fn>;
    detect: () => void;
  } {
    const fixture = TestBed.createComponent(CreateButtonComponent);
    fixture.componentRef.setInput('label', 'New role');
    const pressed = vi.fn();
    fixture.componentInstance.pressed.subscribe(pressed);
    fixture.detectChanges();
    return {
      host: fixture.nativeElement as HTMLElement,
      pressed,
      detect: () => fixture.detectChanges()
    };
  }

  it('renders a filled header button with the add icon and the label', () => {
    const { host, pressed } = render();
    const button = host.querySelector('button') as HTMLButtonElement;

    expect(button.getAttribute('matButton')).toBe('filled');
    expect(button.classList).not.toContain('create-fab');
    expect(button.textContent?.trim()).toBe('add New role');
    button.click();
    expect(pressed).toHaveBeenCalledOnce();
  });

  it('becomes an extended FAB on a handset', () => {
    const { host, pressed, detect } = render();
    isHandset.set(true);
    detect();
    const button = host.querySelector('button') as HTMLButtonElement;

    expect(button.classList).toContain('create-fab');
    expect(button.hasAttribute('extended')).toBe(true);
    expect(button.textContent?.trim()).toBe('add New role');
    button.click();
    expect(pressed).toHaveBeenCalledOnce();
  });
});
