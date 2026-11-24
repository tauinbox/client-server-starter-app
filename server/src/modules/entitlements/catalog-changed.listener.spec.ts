import { CatalogChangedListener } from './catalog-changed.listener';
import type { EntitlementService } from './entitlement.service';
import { settingsChangedEvent } from '../core/settings-change-log/testing/settings-changed-event';

describe('CatalogChangedListener', () => {
  let entitlements: { invalidateCatalog: jest.Mock };
  let listener: CatalogChangedListener;

  beforeEach(() => {
    entitlements = {
      invalidateCatalog: jest.fn().mockResolvedValue(undefined)
    };
    // @ts-expect-error partial mock: only `invalidateCatalog`
    listener = new CatalogChangedListener(entitlements as EntitlementService);
  });

  it.each([
    ['plans', { tables: ['plans' as const] }],
    ['products', { tables: ['billing_products' as const] }],
    ['a rebase', { all: true }]
  ])(
    'drops every entitlement entry on a change of %s',
    async (_case, change) => {
      await listener.handleSettingsChanged(settingsChangedEvent(change));

      expect(entitlements.invalidateCatalog).toHaveBeenCalledTimes(1);
    }
  );

  it('ignores a change of other settings', async () => {
    await listener.handleSettingsChanged(
      settingsChangedEvent({ tables: ['roles', 'feature_flags'] })
    );

    expect(entitlements.invalidateCatalog).not.toHaveBeenCalled();
  });
});
