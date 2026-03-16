import { RequestIdMiddleware } from './request-id.middleware';
import type { Request, Response, NextFunction } from 'express';

function makeReq(headers: Record<string, string> = {}): Request {
  return { headers } as Request;
}

function makeRes(): { setHeader: jest.Mock } & Response {
  return { setHeader: jest.fn() } as { setHeader: jest.Mock } & Response;
}

describe('RequestIdMiddleware', () => {
  let middleware: RequestIdMiddleware;
  let next: NextFunction;

  beforeEach(() => {
    middleware = new RequestIdMiddleware();
    next = jest.fn();
  });

  it('should use x-request-id from incoming header when present', () => {
    const req = makeReq({ 'x-request-id': 'existing-id-123' });
    const res = makeRes();

    middleware.use(req, res as Response, next);

    expect(res.setHeader).toHaveBeenCalledWith(
      'X-Request-Id',
      'existing-id-123'
    );
    expect((req as Request & { requestId: string }).requestId).toBe(
      'existing-id-123'
    );
  });

  it('should generate a UUID when x-request-id header is absent', () => {
    const req = makeReq({});
    const res = makeRes();

    middleware.use(req, res as Response, next);

    const requestId = (req as Request & { requestId: string }).requestId;
    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', requestId);
  });

  it('should call next()', () => {
    const req = makeReq({});
    const res = makeRes();

    middleware.use(req, res as Response, next);

    expect(next).toHaveBeenCalled();
  });

  it('should set unique request ids for different requests', () => {
    const req1 = makeReq({});
    const req2 = makeReq({});
    const res1 = makeRes();
    const res2 = makeRes();

    middleware.use(req1, res1 as Response, next);
    middleware.use(req2, res2 as Response, next);

    const id1 = (req1 as Request & { requestId: string }).requestId;
    const id2 = (req2 as Request & { requestId: string }).requestId;
    expect(id1).not.toBe(id2);
  });
});
