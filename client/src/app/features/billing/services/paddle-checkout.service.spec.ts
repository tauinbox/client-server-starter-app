import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { TranslocoService } from '@jsverse/transloco';
import type { PaddleClientConfigResponse } from '@app/shared/types';
import { BillingService } from './billing.service';
import {
  type PaddleCheckoutResult,
  PaddleCheckoutService
} from './paddle-checkout.service';

const TXN = 'txn_01h8abc';
const SCRIPT_ID = 'paddle-js-script';

const configured: PaddleClientConfigResponse = {
  clientToken: 'test_token',
  environment: 'sandbox'
};

type PaddleStub = NonNullable<Window['Paddle']>;

function paddleStub() {
  let callback: (event: { name?: string }) => void = () => undefined;
  const stub = {
    Environment: { set: vi.fn() },
    Initialize: vi.fn((options: Parameters<PaddleStub['Initialize']>[0]) => {
      callback = options.eventCallback;
    }),
    Checkout: {
      open: vi.fn(),
      close: vi.fn(() => callback({ name: 'checkout.closed' }))
    }
  } satisfies PaddleStub;
  return { stub, emit: (name: string) => callback({ name }) };
}

describe('PaddleCheckoutService', () => {
  let service: PaddleCheckoutService;
  let getPaddleConfig: ReturnType<typeof vi.fn>;
  let paddle: ReturnType<typeof paddleStub>;

  beforeEach(() => {
    paddle = paddleStub();
    window.Paddle = paddle.stub;
    getPaddleConfig = vi.fn().mockReturnValue(of(configured));

    TestBed.configureTestingModule({
      providers: [
        { provide: BillingService, useValue: { getPaddleConfig } },
        { provide: TranslocoService, useValue: { getActiveLang: () => 'ru' } }
      ]
    });
    service = TestBed.inject(PaddleCheckoutService);
  });

  afterEach(() => {
    delete window.Paddle;
    document.getElementById(SCRIPT_ID)?.remove();
  });

  /** Opens a checkout and waits until the overlay is open. */
  async function opened(): Promise<{ result: Promise<PaddleCheckoutResult> }> {
    const result = service.open(TXN);
    await vi.waitFor(() =>
      expect(paddle.stub.Checkout.open).toHaveBeenCalled()
    );
    return { result };
  }

  it('initializes Paddle.js with the advertised token and environment', async () => {
    await opened();

    expect(paddle.stub.Environment.set).toHaveBeenCalledWith('sandbox');
    expect(paddle.stub.Initialize).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'test_token' })
    );
    expect(paddle.stub.Checkout.open).toHaveBeenCalledWith({
      transactionId: TXN,
      settings: { displayMode: 'overlay', locale: 'ru' }
    });
  });

  it('resolves completed on checkout.completed and closes the overlay', async () => {
    const { result } = await opened();

    paddle.emit('checkout.completed');

    await expect(result).resolves.toBe('completed');
    expect(paddle.stub.Checkout.close).toHaveBeenCalled();
  });

  it('resolves closed when the buyer closes the overlay', async () => {
    const { result } = await opened();

    paddle.emit('checkout.closed');

    await expect(result).resolves.toBe('closed');
  });

  it('initializes Paddle.js once for several checkouts', async () => {
    const first = await opened();
    paddle.emit('checkout.closed');
    await first.result;
    paddle.stub.Checkout.open.mockClear();

    await opened();

    expect(paddle.stub.Initialize).toHaveBeenCalledTimes(1);
    expect(getPaddleConfig).toHaveBeenCalledTimes(1);
  });

  it('is unavailable while the server advertises no token', async () => {
    getPaddleConfig.mockReturnValue(
      of({ clientToken: null, environment: 'sandbox' })
    );

    await expect(service.open(TXN)).resolves.toBe('unavailable');
    expect(paddle.stub.Initialize).not.toHaveBeenCalled();
  });

  it('is unavailable when the config request fails, and retries on the next open', async () => {
    getPaddleConfig.mockReturnValueOnce(throwError(() => new Error('503')));

    await expect(service.open(TXN)).resolves.toBe('unavailable');

    await opened();
    expect(getPaddleConfig).toHaveBeenCalledTimes(2);
  });

  it('appends the CDN script and is unavailable when it does not load', async () => {
    delete window.Paddle;

    const result = service.open(TXN);
    await vi.waitFor(() =>
      expect(document.getElementById(SCRIPT_ID)).not.toBeNull()
    );
    const tag = document.getElementById(SCRIPT_ID) as HTMLScriptElement;
    expect(tag.src).toBe('https://cdn.paddle.com/paddle/v2/paddle.js');
    tag.dispatchEvent(new Event('error'));

    await expect(result).resolves.toBe('unavailable');
    expect(document.getElementById(SCRIPT_ID)).toBeNull();
  });

  it('refuses a value that is not a Paddle transaction id', async () => {
    await expect(service.open('javascript:alert(1)')).resolves.toBe(
      'unavailable'
    );
    expect(getPaddleConfig).not.toHaveBeenCalled();
  });
});
