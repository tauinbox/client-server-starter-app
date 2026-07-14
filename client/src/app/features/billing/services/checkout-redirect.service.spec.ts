import { TestBed } from '@angular/core/testing';
import { DOCUMENT } from '@angular/core';
import { NotifyService } from '@core/services/notify.service';
import {
  CheckoutRedirectService,
  isSafeCheckoutUrl
} from './checkout-redirect.service';

const ORIGIN = 'http://localhost:4200';

describe('isSafeCheckoutUrl', () => {
  it('accepts https URLs on any host', () => {
    expect(isSafeCheckoutUrl('https://checkout.paddle.com/pay/1', ORIGIN)).toBe(
      true
    );
    expect(isSafeCheckoutUrl('https://mock-checkout.local/x', ORIGIN)).toBe(
      true
    );
  });

  it('accepts relative and same-origin URLs (dev / mock backend)', () => {
    expect(isSafeCheckoutUrl('/billing/success', ORIGIN)).toBe(true);
    expect(isSafeCheckoutUrl(`${ORIGIN}/billing/success`, ORIGIN)).toBe(true);
  });

  it('rejects javascript:, data: and other non-https schemes', () => {
    expect(isSafeCheckoutUrl('javascript:alert(1)', ORIGIN)).toBe(false);
    expect(isSafeCheckoutUrl('data:text/html,<script>1</script>', ORIGIN)).toBe(
      false
    );
    expect(isSafeCheckoutUrl('vbscript:x', ORIGIN)).toBe(false);
  });

  it('rejects cross-origin http URLs', () => {
    expect(isSafeCheckoutUrl('http://evil.example/pay', ORIGIN)).toBe(false);
  });

  it('rejects unparseable input', () => {
    expect(isSafeCheckoutUrl('https://', ORIGIN)).toBe(false);
  });
});

describe('CheckoutRedirectService', () => {
  let service: CheckoutRedirectService;
  let fakeWindow: { location: { origin: string; href: string } };
  let notifyMock: { error: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    fakeWindow = { location: { origin: ORIGIN, href: 'initial' } };
    notifyMock = { error: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        { provide: DOCUMENT, useValue: { defaultView: fakeWindow } },
        { provide: NotifyService, useValue: notifyMock }
      ]
    });
    service = TestBed.inject(CheckoutRedirectService);
  });

  it('navigates to a valid https checkout URL', () => {
    service.redirect('https://checkout.paddle.com/pay/1');
    expect(fakeWindow.location.href).toBe('https://checkout.paddle.com/pay/1');
    expect(notifyMock.error).not.toHaveBeenCalled();
  });

  it('does not navigate to a javascript: URL and surfaces a translated error', () => {
    service.redirect('javascript:alert(document.cookie)');
    expect(fakeWindow.location.href).toBe('initial');
    expect(notifyMock.error).toHaveBeenCalledWith(
      'billing.errors.unsafeRedirect'
    );
  });

  it('does not navigate to a cross-origin http URL', () => {
    service.redirect('http://evil.example/pay');
    expect(fakeWindow.location.href).toBe('initial');
    expect(notifyMock.error).toHaveBeenCalledWith(
      'billing.errors.unsafeRedirect'
    );
  });
});
