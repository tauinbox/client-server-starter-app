import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { FeatureFlagGuard } from '../guards/feature-flag.guard';
import { FEATURE_FLAG_KEY } from '../constants/feature-flag-metadata.constants';

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
