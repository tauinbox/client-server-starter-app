import { RequestIdMiddleware } from './request-id.middleware';
import type { Request, Response, NextFunction } from 'express';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function makeReq(headers: Record<string, string | string[]> = {}): Request {
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

  it('should use x-request-id from incoming header when present and valid', () => {
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

  it('should keep a valid UUID', () => {
    const uuid = '11111111-2222-3333-4444-555555555555';
    const req = makeReq({ 'x-request-id': uuid });
    const res = makeRes();

    middleware.use(req, res as Response, next);

    expect((req as Request & { requestId: string }).requestId).toBe(uuid);
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', uuid);
  });

  it('should generate a UUID when x-request-id header is absent', () => {
    const req = makeReq({});
    const res = makeRes();

    middleware.use(req, res as Response, next);

    const requestId = (req as Request & { requestId: string }).requestId;
    expect(requestId).toMatch(UUID_REGEX);
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', requestId);
  });

  it('should replace empty x-request-id with a generated UUID', () => {
    const req = makeReq({ 'x-request-id': '' });
    const res = makeRes();

    middleware.use(req, res as Response, next);

    const requestId = (req as Request & { requestId: string }).requestId;
    expect(requestId).toMatch(UUID_REGEX);
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', requestId);
  });

  it('should replace overly long x-request-id with a generated UUID', () => {
    const req = makeReq({ 'x-request-id': 'a'.repeat(65) });
    const res = makeRes();

    middleware.use(req, res as Response, next);

    const requestId = (req as Request & { requestId: string }).requestId;
    expect(requestId).toMatch(UUID_REGEX);
    expect(requestId).not.toBe('a'.repeat(65));
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', requestId);
  });

  it('should accept a maximum-length 64-char value', () => {
    const value = 'a'.repeat(64);
    const req = makeReq({ 'x-request-id': value });
    const res = makeRes();

    middleware.use(req, res as Response, next);

    expect((req as Request & { requestId: string }).requestId).toBe(value);
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', value);
  });

  it('should replace x-request-id containing disallowed characters with a generated UUID', () => {
    const req = makeReq({ 'x-request-id': 'evil<script>alert(1)</script>' });
    const res = makeRes();

    middleware.use(req, res as Response, next);

    const requestId = (req as Request & { requestId: string }).requestId;
    expect(requestId).toMatch(UUID_REGEX);
    expect(requestId).not.toContain('<');
  });

  it('should replace x-request-id containing whitespace with a generated UUID', () => {
    const req = makeReq({ 'x-request-id': 'has spaces' });
    const res = makeRes();

    middleware.use(req, res as Response, next);

    const requestId = (req as Request & { requestId: string }).requestId;
    expect(requestId).toMatch(UUID_REGEX);
    expect(requestId).not.toContain(' ');
  });

  it('should replace an array-typed x-request-id (multiple headers) with a generated UUID', () => {
    const req = makeReq({ 'x-request-id': ['a', 'b'] });
    const res = makeRes();

    middleware.use(req, res as Response, next);

    const requestId = (req as Request & { requestId: string }).requestId;
    expect(requestId).toMatch(UUID_REGEX);
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
