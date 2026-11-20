import type { Request, Response } from 'express';
import { NoStoreMiddleware } from './no-store.middleware';

describe('NoStoreMiddleware', () => {
  it('sets Cache-Control: no-store and calls next', () => {
    const setHeader = jest.fn();
    const next = jest.fn();

    new NoStoreMiddleware().use(
      {} as Request,
      { setHeader } as Partial<Response> as Response,
      next
    );

    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(next).toHaveBeenCalledTimes(1);
  });
});
