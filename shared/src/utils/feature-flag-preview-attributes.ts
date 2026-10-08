import {
  FEATURE_FLAG_PREVIEW_ATTRIBUTES_MAX_KEYS,
  FEATURE_FLAG_PREVIEW_ATTRIBUTE_KEY_MAX_LENGTH
} from '../constants/feature-flag.constants';

/**
 * The bounds of the preview `attributes` map, shared by the server DTO and the
 * mock so both answer with the same message. A value that is not a plain
 * object is left to `@IsObject()`.
 */
export function findPreviewAttributesError(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const keys = Object.keys(value);
  if (keys.length > FEATURE_FLAG_PREVIEW_ATTRIBUTES_MAX_KEYS) {
    return `attributes must contain no more than ${FEATURE_FLAG_PREVIEW_ATTRIBUTES_MAX_KEYS} keys`;
  }
  if (
    keys.some(
      (key) =>
        key.length === 0 ||
        key.length > FEATURE_FLAG_PREVIEW_ATTRIBUTE_KEY_MAX_LENGTH
    )
  ) {
    return `each key in attributes must be from 1 to ${FEATURE_FLAG_PREVIEW_ATTRIBUTE_KEY_MAX_LENGTH} characters long`;
  }
  return null;
}
