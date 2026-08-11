import type { Server } from 'http';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { resetState } from '../state';
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

interface ErrorBody {
  message: string;
  errors?: string[];
  statusCode: number;
  error?: string;
}

async function send(
  method: string,
  path: string,
  body: unknown,
  token: string
): Promise<{ status: number; body: ErrorBody }> {
  const res = await fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });
  return { status: res.status, body: (await res.json()) as ErrorBody };
}

async function activateSubscription(
  planKey: string
): Promise<{ id: string; customerId: string }> {
  const res = await fetch(
    `${baseUrl}/__control/billing/activate-subscription`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: mockId('user-2'), planKey })
    }
  );
  expect(res.status).toBe(200);
  return (await res.json()) as { id: string; customerId: string };
}

const SOME_UUID = mockId('some-row');

function validUsageBody(): Record<string, unknown> {
  return {
    customerId: SOME_UUID,
    meterKey: 'api_calls',
    quantity: 1,
    idempotencyKey: 'evt-parity'
  };
}

// A body the server's ValidationPipe refuses must never reach mock business
// logic, or an e2e run goes green against behaviour production lacks. Expected
// messages were measured by running the server's DTOs through that pipe, which
// reports unknown properties first, then each property as declared.
describe('billing request-body validation parity with server', () => {
  interface RouteCase {
    name: string;
    method: string;
    path: string;
    /** A body the route accepts, before the offending key is added. */
    valid: Record<string, unknown>;
    admin?: boolean;
  }

  // Every billing route whose server counterpart binds a request DTO. The
  // webhook receivers and POST /billing/payment-method take no @Body(), so the
  // pipe never runs for them and they are deliberately absent.
  const routes: RouteCase[] = [
    {
      name: 'POST /billing/checkout',
      method: 'POST',
      path: '/billing/checkout',
      valid: { planKey: 'pro' }
    },
    {
      name: 'POST /billing/purchase',
      method: 'POST',
      path: '/billing/purchase',
      valid: { productKey: 'report-pack' }
    },
    {
      name: 'POST /billing/subscription/change',
      method: 'POST',
      path: '/billing/subscription/change',
      valid: { planKey: 'business' }
    },
    {
      name: 'POST /billing/subscription/change/preview',
      method: 'POST',
      path: '/billing/subscription/change/preview',
      valid: { planKey: 'business' }
    },
    {
      name: 'POST /billing/subscription/cancel',
      method: 'POST',
      path: '/billing/subscription/cancel',
      valid: { mode: 'immediate' }
    },
    {
      name: 'PUT /billing/region',
      method: 'PUT',
      path: '/billing/region',
      valid: { region: 'auto' }
    },
    {
      name: 'POST /admin/billing/subscriptions/:id/cancel',
      method: 'POST',
      path: `/admin/billing/subscriptions/${SOME_UUID}/cancel`,
      valid: { mode: 'immediate' },
      admin: true
    },
    {
      name: 'POST /admin/billing/invoices/:id/refund',
      method: 'POST',
      path: `/admin/billing/invoices/${SOME_UUID}/refund`,
      valid: { amountMinor: 100 },
      admin: true
    },
    {
      name: 'POST /admin/billing/usage',
      method: 'POST',
      path: '/admin/billing/usage',
      valid: validUsageBody(),
      admin: true
    }
  ];

  describe('forbidNonWhitelisted: a property no DTO declares', () => {
    it.each(routes)('$name rejects it with 400', async (route) => {
      const token = await login(
        route.admin ? 'admin@example.com' : 'user@example.com'
      );

      const { status, body } = await send(
        route.method,
        route.path,
        { ...route.valid, sneaky: 'value' },
        token
      );

      expect(status).toBe(400);
      expect(body.errors).toEqual(['property sneaky should not exist']);
      expect(body.message).toBe('property sneaky should not exist');
      expect(body.error).toBe('Bad Request');
    });
  });

  describe('per-DTO bounds', () => {
    interface BoundsCase {
      name: string;
      method: string;
      path: string;
      body: Record<string, unknown>;
      errors: string[];
      admin?: boolean;
    }

    const cases: BoundsCase[] = [
      {
        name: 'checkout planKey over 100 chars',
        method: 'POST',
        path: '/billing/checkout',
        body: { planKey: 'x'.repeat(101) },
        errors: ['planKey must be shorter than or equal to 100 characters']
      },
      {
        name: 'plan change planKey over 100 chars',
        method: 'POST',
        path: '/billing/subscription/change',
        body: { planKey: 'x'.repeat(101) },
        errors: ['planKey must be shorter than or equal to 100 characters']
      },
      {
        name: 'change preview planKey over 100 chars',
        method: 'POST',
        path: '/billing/subscription/change/preview',
        body: { planKey: 'x'.repeat(101) },
        errors: ['planKey must be shorter than or equal to 100 characters']
      },
      {
        name: 'purchase productKey over 100 chars',
        method: 'POST',
        path: '/billing/purchase',
        body: { productKey: 'x'.repeat(101) },
        errors: ['productKey must be shorter than or equal to 100 characters']
      },
      {
        name: 'purchase description over 128 chars',
        method: 'POST',
        path: '/billing/purchase',
        body: { productKey: 'report-pack', description: 'y'.repeat(129) },
        errors: ['description must be shorter than or equal to 128 characters']
      },
      {
        name: 'purchase description that is not a string',
        method: 'POST',
        path: '/billing/purchase',
        body: { productKey: 'report-pack', description: 7 },
        errors: [
          'description must be shorter than or equal to 128 characters',
          'description must be a string'
        ]
      },
      {
        name: 'cancel mode outside the enum',
        method: 'POST',
        path: '/billing/subscription/cancel',
        body: { mode: 'right-now' },
        errors: [
          'mode must be one of the following values: period_end, immediate'
        ]
      },
      {
        name: 'usage customerId that is not a UUID',
        method: 'POST',
        path: '/admin/billing/usage',
        // Passes ParseUUIDPipe's looser route-param pattern, but @IsUUID() on a
        // body field requires the version and variant nibbles.
        body: {
          ...validUsageBody(),
          customerId: '11111111-1111-1111-1111-111111111111'
        },
        errors: ['customerId must be a UUID'],
        admin: true
      },
      {
        name: 'usage quantity above the @Max bound',
        method: 'POST',
        path: '/admin/billing/usage',
        body: { ...validUsageBody(), quantity: 1_000_000_001 },
        errors: ['quantity must not be greater than 1000000000'],
        admin: true
      },
      {
        name: 'usage occurredAt that is parseable but not ISO 8601',
        method: 'POST',
        path: '/admin/billing/usage',
        body: { ...validUsageBody(), occurredAt: 'January 1, 2023' },
        errors: ['occurredAt must be a valid ISO 8601 date string'],
        admin: true
      },
      {
        name: 'usage meterKey over 100 chars',
        method: 'POST',
        path: '/admin/billing/usage',
        body: { ...validUsageBody(), meterKey: 'm'.repeat(101) },
        errors: ['meterKey must be shorter than or equal to 100 characters'],
        admin: true
      }
    ];

    it.each(cases)('rejects $name', async (testCase) => {
      const token = await login(
        testCase.admin ? 'admin@example.com' : 'user@example.com'
      );

      const { status, body } = await send(
        testCase.method,
        testCase.path,
        testCase.body,
        token
      );

      expect(status).toBe(400);
      expect(body.errors).toEqual(testCase.errors);
      expect(body.message).toBe(testCase.errors.join('. '));
    });
  });

  it('reports unknown properties ahead of the field errors, joined into message', async () => {
    const token = await login('user@example.com');

    const { status, body } = await send(
      'POST',
      '/billing/checkout',
      { foo: 1, bar: 2, planKey: '' },
      token
    );

    expect(status).toBe(400);
    expect(body.errors).toEqual([
      'property foo should not exist',
      'property bar should not exist',
      'planKey must be longer than or equal to 1 characters'
    ]);
    expect(body.message).toBe(body.errors?.join('. '));
  });

  // The bounds must not be tighter than the server's either: a value the DTO
  // accepts has to reach the handler and get the business-logic answer.
  describe('what the server accepts still passes', () => {
    it('takes a planKey of exactly 100 chars through to the catalog lookup', async () => {
      const token = await login('user@example.com');

      const { status } = await send(
        'POST',
        '/billing/checkout',
        { planKey: 'x'.repeat(100) },
        token
      );

      expect(status).toBe(404);
    });

    it('trims before measuring, as the DTO @Transform does', async () => {
      const token = await login('user@example.com');

      const { status } = await send(
        'POST',
        '/billing/purchase',
        { productKey: `  ${'x'.repeat(100)}  ` },
        token
      );

      expect(status).toBe(404);
    });

    it('opens a purchase session with a 128-char description', async () => {
      const token = await login('user@example.com');

      const { status } = await send(
        'POST',
        '/billing/purchase',
        { productKey: 'report-pack', description: 'y'.repeat(128) },
        token
      );

      expect(status).toBe(200);
    });

    it('records usage with a date-only ISO 8601 occurredAt', async () => {
      const token = await login('admin@example.com');
      const { customerId } = await activateSubscription('usage');

      const { status } = await send(
        'POST',
        '/admin/billing/usage',
        { ...validUsageBody(), customerId, occurredAt: '2023-01-01' },
        token
      );

      expect(status).toBe(201);
    });

    it('keeps an explicit null optional field legal, as @IsOptional() does', async () => {
      const token = await login('user@example.com');

      const { status } = await send(
        'POST',
        '/billing/purchase',
        { productKey: 'report-pack', description: null },
        token
      );

      expect(status).toBe(200);
    });
  });
});
