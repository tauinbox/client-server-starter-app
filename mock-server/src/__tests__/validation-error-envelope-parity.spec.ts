import type { Server } from 'http';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { findUserByEmail, getState, resetState } from '../state';
import { mockId } from '../utils/mock-id';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  resetState();
  const app = createApp();
  server = await listenOnUnblockedPort(app);
  baseUrl = baseUrlOf(server);
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  resetState();
});

async function login(email: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'Password1' })
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { tokens: { access_token: string } };
  return body.tokens.access_token;
}

type ErrorBody = { message: string; errors?: string[] };

async function send(
  method: string,
  path: string,
  body: unknown,
  token?: string
): Promise<{ status: number; body: ErrorBody }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  });
  return { status: res.status, body: (await res.json()) as ErrorBody };
}

// GlobalExceptionFilter attaches `errors` to ValidationPipe rejections only,
// and the client keys off it to choose a translated generic message over raw
// validator text - so the mock must reproduce the split, not just the status.
describe('validation-error envelope parity with server', () => {
  describe('a 400 mirroring class-validator carries errors[]', () => {
    it('auth: register with a malformed email', async () => {
      const { status, body } = await send('POST', '/api/v1/auth/register', {
        email: 'not-an-email',
        firstName: 'A',
        lastName: 'B',
        password: 'Password1'
      });

      expect(status).toBe(400);
      expect(body.errors).toEqual([body.message]);
      expect(body.errors?.join(' ')).toContain('email');
    });

    it('users: PATCH with a non-boolean isActive', async () => {
      const token = await login('admin@example.com');
      const target = findUserByEmail('user@example.com');
      const { status, body } = await send(
        'PATCH',
        `/api/v1/users/${target?.id}`,
        { isActive: 'yes' },
        token
      );

      expect(status).toBe(400);
      expect(body.errors).toEqual(['isActive must be a boolean value']);
    });

    it('roles: assigning an empty permissionIds array', async () => {
      const token = await login('admin@example.com');
      const { status, body } = await send(
        'POST',
        `/api/v1/roles/${mockId('role-editor')}/permissions`,
        { permissionIds: [] },
        token
      );

      expect(status).toBe(400);
      expect(body.errors).toEqual(['permissionIds should not be empty']);
    });

    it('rbac: creating an action without a name', async () => {
      const token = await login('admin@example.com');
      const { status, body } = await send(
        'POST',
        '/api/v1/rbac/actions',
        { displayName: 'Publish', description: 'Publish a record' },
        token
      );

      expect(status).toBe(400);
      expect(body.errors).toEqual(['name is required']);
    });

    it('billing: an unsupported region', async () => {
      const token = await login('user@example.com');
      const { status, body } = await send(
        'PUT',
        '/api/v1/billing/region',
        { region: 'moon' },
        token
      );

      expect(status).toBe(400);
      expect(body.errors).toEqual([
        'region must be one of the following values: auto, ru, world'
      ]);
    });

    it('feature-flags: creating a flag with a malformed key', async () => {
      const token = await login('admin@example.com');
      const { status, body } = await send(
        'POST',
        '/api/v1/admin/feature-flags',
        { key: 'Not A Key' },
        token
      );

      expect(status).toBe(400);
      expect(body.errors).toEqual([body.message]);
      expect(body.errors?.join(' ')).toContain('key must match');
    });

    it('feature-flags: a rules array whose entry has an unknown type', async () => {
      const token = await login('admin@example.com');
      const { status, body } = await send(
        'PUT',
        `/api/v1/admin/feature-flags/${mockId('flag-new-dashboard')}/rules`,
        { rules: [{ effect: 'include', type: 'nope', payload: {} }] },
        token
      );

      expect(status).toBe(400);
      expect(body.errors).toEqual([body.message]);
      expect(body.errors?.join(' ')).toContain('rules[0].type');
    });
  });

  describe('a 400 thrown by service logic carries no errors[]', () => {
    it('auth: an unknown email-verification token', async () => {
      const { status, body } = await send('POST', '/api/v1/auth/verify-email', {
        token: 'nope'
      });

      expect(status).toBe(400);
      expect(body.errors).toBeUndefined();
      expect(body.message).toBe('Invalid or expired verification token');
    });

    it('roles: setting isSuper through the API', async () => {
      const token = await login('admin@example.com');
      const { status, body } = await send(
        'POST',
        '/api/v1/roles',
        { name: 'escalated', isSuper: true },
        token
      );

      expect(status).toBe(400);
      expect(body.errors).toBeUndefined();
      expect(body.message).toBe('isSuper flag cannot be set via API');
    });

    it('rbac: creating an action with a CASL-reserved name', async () => {
      const token = await login('admin@example.com');
      const { status, body } = await send(
        'POST',
        '/api/v1/rbac/actions',
        { name: 'manage', displayName: 'Manage', description: 'Manage all' },
        token
      );

      expect(status).toBe(400);
      expect(body.errors).toBeUndefined();
      expect(body.message).toContain('is reserved');
    });

    it('billing: a webhook with an empty body', async () => {
      const { status, body } = await send(
        'POST',
        '/api/v1/billing/webhooks/paddle',
        {}
      );

      expect(status).toBe(400);
      expect(body.errors).toBeUndefined();
      expect(body.message).toBe('Missing webhook body');
    });

    it('feature-flags: a rule payload the rule-payload validator rejects', async () => {
      const token = await login('admin@example.com');
      const { status, body } = await send(
        'PUT',
        `/api/v1/admin/feature-flags/${mockId('flag-new-dashboard')}/rules`,
        {
          rules: [
            { effect: 'include', type: 'user', payload: { type: 'user' } }
          ]
        },
        token
      );

      expect(status).toBe(400);
      expect(body.errors).toBeUndefined();
      expect(body.message).toContain('user rule requires userIds');
    });
  });

  // @IsInt()/@Min(1) run before the service's remaining-total check.
  describe('refund amountMinor splits at the DTO boundary', () => {
    async function paidInvoiceId(): Promise<string> {
      const res = await fetch(
        `${baseUrl}/__control/billing/activate-subscription`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ userId: mockId('user-2'), planKey: 'pro' })
        }
      );
      expect(res.status).toBe(200);
      const invoice = [...getState().billingInvoices.values()].find(
        (i) => i.status === 'paid'
      );
      if (!invoice) throw new Error('Activation produced no paid invoice');
      return invoice.id;
    }

    it.each([
      [0, 'amountMinor must not be less than 1'],
      [1.5, 'amountMinor must be an integer number']
    ])('rejects amountMinor=%p as a validation error', async (amount, msg) => {
      const token = await login('admin@example.com');
      const { status, body } = await send(
        'POST',
        `/api/v1/admin/billing/invoices/${await paidInvoiceId()}/refund`,
        { amountMinor: amount },
        token
      );

      expect(status).toBe(400);
      expect(body.errors).toEqual([msg]);
    });

    it('keeps the remaining-total rejection free of errors[]', async () => {
      const token = await login('admin@example.com');
      const { status, body } = await send(
        'POST',
        `/api/v1/admin/billing/invoices/${await paidInvoiceId()}/refund`,
        { amountMinor: 999_999 },
        token
      );

      expect(status).toBe(400);
      expect(body.errors).toBeUndefined();
      expect(body.message).toContain('Refund amount must be between 1');
    });
  });
});
