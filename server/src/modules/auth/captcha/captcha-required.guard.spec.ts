import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { ErrorKeys } from '@app/shared/constants';
import { CaptchaRequiredGuard } from './captcha-required.guard';
import type { CaptchaService } from './captcha.service';

type MockReq = { body?: { captchaToken?: unknown }; ip?: string };
type MockRes = { getHeader: jest.Mock };

function buildContext(req: MockReq, res: MockRes): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: <T>() => req as unknown as T,
      getResponse: <T>() => res as unknown as T,
      getNext: () => undefined
    })
  } as unknown as ExecutionContext;
}

describe('CaptchaRequiredGuard', () => {
  let mockService: jest.Mocked<Pick<CaptchaService, 'isEnabled' | 'verify'>>;
  let guard: CaptchaRequiredGuard;

  beforeEach(() => {
    mockService = {
      isEnabled: jest.fn(),
      verify: jest.fn()
    };
    guard = new CaptchaRequiredGuard(mockService as unknown as CaptchaService);
  });

  it('passes through when captcha service is disabled', async () => {
    mockService.isEnabled.mockReturnValue(false);
    const ctx = buildContext({}, { getHeader: jest.fn() });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(mockService.verify).not.toHaveBeenCalled();
  });

  it('passes through when X-RateLimit-Remaining header is missing', async () => {
    mockService.isEnabled.mockReturnValue(true);
    const ctx = buildContext(
      {},
      { getHeader: jest.fn().mockReturnValue(undefined) }
    );
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(mockService.verify).not.toHaveBeenCalled();
  });

  it('passes through when remaining > threshold', async () => {
    mockService.isEnabled.mockReturnValue(true);
    const ctx = buildContext({}, { getHeader: jest.fn().mockReturnValue(2) });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(mockService.verify).not.toHaveBeenCalled();
  });

  it('throws CAPTCHA_REQUIRED when remaining ≤ threshold and token is missing', async () => {
    mockService.isEnabled.mockReturnValue(true);
    const ctx = buildContext(
      { body: {} },
      { getHeader: jest.fn().mockReturnValue(1) }
    );
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: {
        errorKey: ErrorKeys.AUTH.CAPTCHA_REQUIRED
      },
      status: HttpStatus.BAD_REQUEST
    });
  });

  it('throws CAPTCHA_REQUIRED when token is whitespace-only', async () => {
    mockService.isEnabled.mockReturnValue(true);
    const ctx = buildContext(
      { body: { captchaToken: '   ' } },
      { getHeader: jest.fn().mockReturnValue(1) }
    );
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(HttpException);
  });

  it('throws CAPTCHA_INVALID when verify returns false', async () => {
    mockService.isEnabled.mockReturnValue(true);
    mockService.verify.mockResolvedValue(false);
    const ctx = buildContext(
      { body: { captchaToken: 'bad-token' }, ip: '1.2.3.4' },
      { getHeader: jest.fn().mockReturnValue(1) }
    );
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: {
        errorKey: ErrorKeys.AUTH.CAPTCHA_INVALID
      }
    });
    expect(mockService.verify).toHaveBeenCalledWith('bad-token', '1.2.3.4');
  });

  it('passes when token is valid', async () => {
    mockService.isEnabled.mockReturnValue(true);
    mockService.verify.mockResolvedValue(true);
    const ctx = buildContext(
      { body: { captchaToken: 'good-token' }, ip: '1.2.3.4' },
      { getHeader: jest.fn().mockReturnValue(0) }
    );
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(mockService.verify).toHaveBeenCalledWith('good-token', '1.2.3.4');
  });
});
