import { get, type IncomingMessage, type Server } from 'http';
import type { AddressInfo } from 'net';
import { INestApplication, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { Money } from '@app/shared/utils/money';
import type { NotificationEvent } from '@app/shared/types';
import { CoreModule } from '../src/modules/core/core.module';
import { AuditService } from '../src/modules/audit/audit.service';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { BillingService } from '../src/modules/billing/billing.service';
import { Customer } from '../src/modules/billing/entities/customer.entity';
import { CustomerGrant } from '../src/modules/billing/entities/customer-grant.entity';
import { Invoice } from '../src/modules/billing/entities/invoice.entity';
import { BillingAdminService } from '../src/modules/billing/services/billing-admin.service';
import { EntitlementService } from '../src/modules/entitlements/entitlement.service';
import { UsersService } from '../src/modules/users/services/users.service';
import { SYSTEM_ABILITY } from '../src/modules/auth/casl/app-ability';
import { User } from '../src/modules/users/entities/user.entity';
import { eventually } from './eventually';

// A full refund of a one-time purchase revokes its grant. The client mirror of
// the entitlements must hear about it, as it does for every other billing
// change. Real app, real listener, real stream; only the provider is a stub.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

const CAPABILITY = 'refund-push-capability';

runWithInfra(
  'admin refund tells the client its entitlements changed (e2e)',
  () => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let app: INestApplication;
    let dataSource: DataSource;
    let port: number;
    let user: User;
    let customer: Customer;
    const requests: { destroy: () => void }[] = [];

    beforeAll(async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [CoreModule.forRoot()]
      }).compile();

      app = moduleRef.createNestApplication();
      app.setGlobalPrefix('api');
      app.enableVersioning({ type: VersioningType.URI });
      await app.listen(0);
      port = ((app.getHttpServer() as Server).address() as AddressInfo).port;
      dataSource = app.get(DataSource);

      jest.spyOn(app.get(AuditService), 'log').mockResolvedValue(undefined);
      jest
        .spyOn(app.get(AuditService), 'logFireAndForget')
        .mockImplementation(() => undefined);
      const provider = { refund: jest.fn().mockResolvedValue(undefined) };
      jest
        .spyOn(app.get(BillingService), 'getProviderById')
        // @ts-expect-error the refund path calls only `refund` of the provider
        .mockReturnValue(provider);

      const users = dataSource.getRepository(User);
      user = await users.save(
        users.create({
          email: `refund-push-${stamp}@example.com`,
          firstName: 'Refund',
          lastName: 'Push',
          isEmailVerified: true,
          password: null
        })
      );
      const customers = dataSource.getRepository(Customer);
      customer = await customers.save(
        customers.create({
          userId: user.id,
          provider: 'yookassa',
          providerOverride: null,
          providerCustomerId: `cus_${stamp}`,
          country: 'RU',
          currency: 'RUB',
          defaultPaymentMethodId: null
        })
      );
    }, 60000);

    afterAll(async () => {
      for (const req of requests) req.destroy();
      if (dataSource && customer) {
        await dataSource
          .getRepository(Invoice)
          .delete({ customerId: customer.id });
      }
      if (dataSource && user) {
        await dataSource.getRepository(User).delete({ id: user.id });
      }
      await app?.close();
    });

    async function openStream(): Promise<() => NotificationEvent[]> {
      const { tokens } = await app
        .get(AuthService)
        .login(await app.get(UsersService).findOne(user.id, SYSTEM_ABILITY), {
          userAgent: 'refund-push-e2e',
          ipAddress: '203.0.113.12'
        });
      return new Promise((resolve, reject) => {
        const req = get(
          {
            port,
            path: '/api/v1/notifications/stream',
            headers: { authorization: `Bearer ${tokens.access_token}` }
          },
          (res: IncomingMessage) => {
            if (res.statusCode !== 200) {
              reject(new Error(`stream status ${res.statusCode}`));
              return;
            }
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk: string) => {
              body += chunk;
            });
            res.on('error', () => undefined);
            resolve(() =>
              body
                .split('\n')
                .filter((line) => line.startsWith('data: {'))
                .map((line) => JSON.parse(line.slice(6)) as NotificationEvent)
            );
          }
        );
        req.on('error', () => undefined);
        requests.push(req);
      });
    }

    async function seedGrantedPurchase(): Promise<Invoice> {
      const invoices = dataSource.getRepository(Invoice);
      const now = new Date();
      const invoice = await invoices.save(
        invoices.create({
          customerId: customer.id,
          subscriptionId: null,
          provider: 'yookassa',
          providerEventId: `refund-push-${stamp}`,
          providerInvoiceRef: `pay_${stamp}`,
          amountMinor: Money.fromMinor(49000),
          refundedMinor: Money.fromMinor(0),
          currency: 'RUB',
          status: 'paid',
          creditUnitsApplied: 0,
          billingMode: 'fixed',
          kind: 'one_time',
          productId: null,
          periodStart: now,
          periodEnd: now,
          paidAt: now,
          receiptRef: null
        })
      );
      const grants = dataSource.getRepository(CustomerGrant);
      await grants.save(
        grants.create({
          customerId: customer.id,
          entitlement: CAPABILITY,
          sourceInvoiceId: invoice.id,
          expiresAt: null,
          revokedAt: null
        })
      );
      return invoice;
    }

    it('pushes entitlements_updated after the cache drops the revoked grant', async () => {
      const invoice = await seedGrantedPurchase();
      const entitlements = app.get(EntitlementService);
      expect(
        (await entitlements.capabilitiesFor(user.id)).capabilities
      ).toContain(CAPABILITY);
      const events = await openStream();

      const saved = await app
        .get(BillingAdminService)
        .refundInvoice(invoice.id);

      expect(saved.status).toBe('refunded');
      const pushed = await eventually(async () => {
        const found = events().filter((e) => e.type === 'entitlements_updated');
        return Promise.resolve(found.length > 0 ? found : null);
      });
      expect(pushed).toEqual([{ type: 'entitlements_updated' }]);
      expect(
        (await entitlements.capabilitiesFor(user.id)).capabilities
      ).not.toContain(CAPABILITY);
    });
  }
);
