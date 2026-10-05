import {
  FEATURE_FLAG_LIST_QUERY,
  RESOURCE_LIST_QUERY,
  ROLE_LIST_QUERY
} from '@app/shared/constants';
import { ListCursorQueryDto } from './list-query.dto';

/** One cursor query DTO per admin catalog, built from its list definition. */
export class RoleCursorQueryDto extends ListCursorQueryDto(ROLE_LIST_QUERY) {}

export class ResourceCursorQueryDto extends ListCursorQueryDto(
  RESOURCE_LIST_QUERY
) {}

export class FeatureFlagCursorQueryDto extends ListCursorQueryDto(
  FEATURE_FLAG_LIST_QUERY
) {}
