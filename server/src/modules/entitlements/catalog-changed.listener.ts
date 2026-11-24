import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SettingsChangedEvent } from '../core/settings-change-log/settings-changed.event';
import { touches } from '../core/settings-change-log/settings-change.types';
import { EntitlementService } from './entitlement.service';

/** A change of the plans or products drops the entitlements of every user. */
@Injectable()
export class CatalogChangedListener {
  constructor(private readonly entitlements: EntitlementService) {}

  @OnEvent(SettingsChangedEvent.name, { suppressErrors: false })
  async handleSettingsChanged({ change }: SettingsChangedEvent): Promise<void> {
    if (touches(change, 'plans', 'billing_products')) {
      await this.entitlements.invalidateCatalog();
    }
  }
}
