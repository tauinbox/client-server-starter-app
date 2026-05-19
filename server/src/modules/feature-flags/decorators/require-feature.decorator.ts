import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { FeatureFlagGuard } from '../guards/feature-flag.guard';

export const FEATURE_FLAG_KEY = 'feature_flag_key';

/**
 * Guards a route by feature flag. Returns 404 when the flag is disabled for
 * the caller (anti-enumeration). Use alongside `@Authorize` for permissions:
 * this decorator is convenience only, not the authorization gate.
 */
export const RequireFeature = (key: string) =>
  applyDecorators(
    SetMetadata(FEATURE_FLAG_KEY, key),
    UseGuards(FeatureFlagGuard)
  );
