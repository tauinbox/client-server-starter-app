// The consent to the terms at checkout and purchase, against a real
// PostgreSQL: the refusal of a missing or stale version, the consent row and
// its audit row, one row for each version, and a draft that asks for nothing.

import { expect } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ErrorKeys, LEGAL_DOCUMENTS } from '@app/shared/constants';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { postgresConfig } from '../src/postgres.config';
import { User } from '../src/modules/users/entities/user.entity';
import { AuditLog } from '../src/modules/audit/entities/audit-log.entity';
import { AuditService } from '../src/modules/audit/audit.service';
import { MetricsService } from '../src/modules/core/metrics/metrics.service';
import { BillingConsent } from '../src/modules/billing/entities/billing-consent.entity';
import { Customer } from '../src/modules/billing/entities/customer.entity';
import { Invoice } from '../src/modules/billing/entities/invoice.entity';
import { PaymentMethod } from '../src/modules/billing/entities/payment-method.entity';
import { Plan } from '../src/modules/billing/entities/plan.entity';
import { Product } from '../src/modules/billing/entities/product.entity';
import { Subscription } from '../src/modules/billing/entities/subscription.entity';
import { BillingService } from '../src/modules/billing/billing.service';
import { BillingUserService } from '../src/modules/billing/services/billing-user.service';
import {
  BillingConsentService,
  LEGAL_DOCUMENT_VERSIONS,
  type LegalDocumentVersions
} from '../src/modules/billing/services/billing-consent.service';
import { CreditService } from '../src/modules/billing/services/credit.service';
import { expectRefusal } from '../src/modules/billing/testing/billing-service.fixtures';
import {
  BILLING_DB_LOCK_TIMEOUT_MS,
  holdBillingDbLock
} from './billing-db-lock';
import { repositoryProviders } from './repository-providers';

// Skips without DB_HOST (bare local run); CI provides a migrated Postgres.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

const PLAN = 'terms-consent-pro';
const PRODUCT = 'terms-consent-pack';
const VERSION = '2026-12-01';

const PUBLISHED_RU: LegalDocumentVersions = {
  ...LEGAL_DOCUMENTS,
  ru: {
    ...LEGAL_DOCUMENTS.ru,
    terms: { version: VERSION, status: 'published' }
  }
};

const DRAFT_RU: LegalDocumentVersions = {
  ...LEGAL_DOCUMENTS,
  ru: {
    ...LEGAL_DOCUMENTS.ru,
    terms: { version: VERSION, status: 'draft' }
  }
};

runWithInfra('Consent to the terms at checkout and purchase (e2e)', () => {
  let ds: DataSource;
  let releaseDbLock: (() => Promise<void>) | undefined;
  let startCheckout: jest.Mock;
  let createOneTimePayment: jest.Mock;
  let userId: string | undefined;
  let customerId: string | undefined;

  beforeAll(async () => {
    ds = new DataSource({ ...postgresConfig(), logging: false });
    await ds.initialize();
    releaseDbLock = await holdBillingDbLock(ds);
    await ds.getRepository(Plan).save(
      ds.getRepository(Plan).create({
        key: PLAN,
        name: PLAN,
        description: null,
        billingMode: 'fixed',
        interval: 'month',
        entitlements: [],
        limits: null,
        trialDays: 0,
        active: true,
        prices: { yookassa: { currency: 'RUB', amountMinor: 99000 } }
      })
    );
    await ds.getRepository(Product).save(
      ds.getRepository(Product).create({
        key: PRODUCT,
        name: PRODUCT,
        description: null,
        type: 'sku',
        prices: { yookassa: { currency: 'RUB', amountMinor: 49000 } },
        grant: { entitlement: 'reports', durationDays: 30 },
        active: true
      })
    );
  }, BILLING_DB_LOCK_TIMEOUT_MS);

  beforeEach(async () => {
    startCheckout = jest
      .fn()
      .mockResolvedValue({ url: 'https://checkout/x', sessionRef: 'sess-1' });
    createOneTimePayment = jest
      .fn()
      .mockResolvedValue({ url: 'https://pay/x', sessionRef: 'ot-1' });

    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const user = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        email: `terms-consent-${stamp}@example.com`,
        name: 'Terms Consent',
        password: 'hashed'
      })
    );

    userId = user.id;
    const customer = await ds.getRepository(Customer).save(
      ds.getRepository(Customer).create({
        userId: user.id,
        provider: 'yookassa',
        providerOverride: null,
        providerCustomerId: null,
        country: 'RU',
        currency: 'RUB',
        defaultPaymentMethodId: null
      })
    );

    customerId = customer.id;
  });

  afterEach(async () => {
    if (userId) {
      // The consent rows hold the user under RESTRICT.
      await ds.getRepository(BillingConsent).delete({ userId });
      await ds.getRepository(AuditLog).delete({ actorId: userId });
    }

    if (customerId) {
      await ds.getRepository(Invoice).delete({ customerId });
      customerId = undefined;
    }

    if (userId) {
      await ds.getRepository(User).delete({ id: userId });
      userId = undefined;
    }
  });

  afterAll(async () => {
    await ds?.getRepository(Plan).delete({ key: PLAN });
    await ds?.getRepository(Product).delete({ key: PRODUCT });
    await releaseDbLock?.();
    await ds?.destroy();
  });

  async function build(documents: LegalDocumentVersions) {
    const provider = {
      id: 'yookassa',
      managesLifecycle: false,
      startCheckout,
      createOneTimePayment
    };
    const module = await Test.createTestingModule({
      providers: [
        BillingUserService,
        BillingConsentService,
        AuditService,
        { provide: LEGAL_DOCUMENT_VERSIONS, useValue: documents },
        { provide: getDataSourceToken(), useValue: ds },
        { provide: DataSource, useValue: ds },
        ...repositoryProviders(ds, [
          AuditLog,
          Customer,
          Subscription,
          Invoice,
          PaymentMethod,
          Plan,
          Product,
          User
        ]),
        {
          provide: BillingService,
          useValue: {
            getProviderById: () => provider,
            resolveProvider: () => Promise.resolve(provider)
          }
        },
        {
          provide: CreditService,
          useValue: { getBalance: () => Promise.resolve(null) }
        },
        {
          provide: MetricsService,
          useValue: { recordAuditWriteFailure: jest.fn() }
        },
        {
          provide: ConfigService,
          useValue: { get: () => 'http://localhost:4200' }
        },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } }
      ]
    }).compile();

    return {
      service: module.get(BillingUserService),
      consents: module.get(BillingConsentService)
    };
  }

  const terms = (acceptedVersion?: string) => ({
    acceptedVersion,
    actorEmail: 'buyer@example.com',
    context: { ip: '203.0.113.7', requestId: 'req-1' }
  });

  const consentRows = () =>
    ds.getRepository(BillingConsent).find({ where: { userId } });

  const auditRows = () =>
    ds.getRepository(AuditLog).find({
      where: { actorId: userId, action: AuditAction.BILLING_TERMS_ACCEPT }
    });

  it.each([
    ['no version', undefined],
    ['a stale version', '2026-11-14']
  ])(
    'refuses a checkout with %s and writes nothing',
    async (_case, version) => {
      const { service } = await build(PUBLISHED_RU);

      await expectRefusal(
        service.checkout(userId!, PLAN, terms(version)),
        ErrorKeys.BILLING.TERMS_NOT_ACCEPTED
      );

      expect(startCheckout).not.toHaveBeenCalled();
      expect(await consentRows()).toEqual([]);
      expect(await auditRows()).toEqual([]);
      expect(await ds.getRepository(Subscription).countBy({ customerId })).toBe(
        0
      );
    }
  );

  it('records the consent and its audit row, then starts the checkout', async () => {
    const { service } = await build(PUBLISHED_RU);

    await service.checkout(userId!, PLAN, terms(VERSION));

    const [consent] = await consentRows();

    expect(await consentRows()).toHaveLength(1);
    expect(consent).toMatchObject({
      userId,
      kind: 'terms',
      jurisdiction: 'ru',
      documentVersion: VERSION
    });
    expect(await auditRows()).toEqual([
      expect.objectContaining({
        actorEmail: 'buyer@example.com',
        targetId: consent.id,
        targetType: 'BillingConsent',
        details: { jurisdiction: 'ru', version: VERSION },
        ipAddress: '203.0.113.7',
        requestId: 'req-1'
      })
    ]);
    expect(startCheckout).toHaveBeenCalledTimes(1);
  });

  it('refuses a purchase with no version, and records a purchase with the version', async () => {
    const { service } = await build(PUBLISHED_RU);

    await expectRefusal(
      service.purchase(userId!, { productKey: PRODUCT }, terms()),
      ErrorKeys.BILLING.TERMS_NOT_ACCEPTED
    );
    expect(createOneTimePayment).not.toHaveBeenCalled();

    await service.purchase(userId!, { productKey: PRODUCT }, terms(VERSION));

    expect(await consentRows()).toHaveLength(1);
    expect(createOneTimePayment).toHaveBeenCalledTimes(1);
  });

  it('writes one row and one audit row for a version that the user accepts again', async () => {
    const { service } = await build(PUBLISHED_RU);

    await service.purchase(userId!, { productKey: PRODUCT }, terms(VERSION));
    await service.purchase(userId!, { productKey: PRODUCT }, terms(VERSION));

    expect(await consentRows()).toHaveLength(1);
    expect(await auditRows()).toHaveLength(1);
    expect(createOneTimePayment).toHaveBeenCalledTimes(2);
  });

  it('writes one row when two acceptances of a version commit at the same time', async () => {
    const { consents } = await build(PUBLISHED_RU);
    const checked = consents.check('yookassa', terms(VERSION));

    await Promise.all([
      consents.record(userId!, checked),
      consents.record(userId!, checked),
      consents.record(userId!, checked)
    ]);

    expect(await consentRows()).toHaveLength(1);
    expect(await auditRows()).toHaveLength(1);
  });

  it('asks for no consent while the terms are a draft', async () => {
    const { service } = await build(DRAFT_RU);

    await service.checkout(userId!, PLAN, terms(VERSION));

    expect(startCheckout).toHaveBeenCalledTimes(1);
    expect(await consentRows()).toEqual([]);
    expect(await auditRows()).toEqual([]);
  });
});
